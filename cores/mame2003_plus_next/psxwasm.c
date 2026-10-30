/***************************************************************************

    psxwasm.c

    Recompiler for the PSX CPU (R3000A) that emits WebAssembly, for
    builds that run in a browser (included by psxjit.c when the sljit
    recompiler is not available and the build targets Emscripten).

    Written for RetroPlay (https://github.com/emircangencer-ctrl/retroteo1)
    on top of libretro/mame2003-plus-libretro, under the same license as
    the rest of the core.

    It follows psxjit.c rule for rule; only the code it produces differs.
    A block is a straight-line run of supported instructions ending at a
    jump (with its delay slot) or at the first unsupported instruction.
    Blocks only run when the timeslice has room for all of them, so the
    instruction timing is exactly the interpreter's; anything else
    (other addresses, exceptions, misaligned accesses, stores over
    translated code) leaves the block just before that instruction and
    the interpreter runs it.

    What differs from psxjit.c:

    - Each block becomes one small WebAssembly module (one function) that
      imports the core's memory and function table, compiled and
      instantiated synchronously from JavaScript and put into the core's
      function table, so the interpreter loop calls it like a C function.
      Browsers compile at most 4 KB synchronously on the main thread: a
      block whose module would be bigger is retried shorter.
    - The general registers a block uses live in WebAssembly locals
      (loaded on entry, stored on every way out and around the calls to
      C helpers), which the browser keeps in machine registers.
    - Jumps back to an earlier instruction of the same block (loops) go
      through a small dispatch loop (br_table over the jump targets).
    - Blocks chain: a block that ends at a jump looks the next block up
      in the cache itself and, when it is translated and fits in the
      timeslice, continues there with a tail call (return_call_indirect);
      otherwise it returns the next pc to jit_run. Browsers without tail
      calls get plain returns.
    - Blocks start where the interpreter arrives by a jump (or after a
      block, or after an instruction a block cannot run), never in the
      middle of straight code: a timeslice that ends inside a block makes
      the interpreter run on to the next jump, instead of making the
      middle of the block a block of its own.

    PSXJIT_VERIFY works as in psxjit.c: every block also runs through
    the interpreter from the same state and the results are compared.

***************************************************************************/

#include <emscripten.h>
#include <stddef.h>

#define JIT_TABLE_BITS		18
#define JIT_TABLE_SIZE		(1 << JIT_TABLE_BITS)
#define JIT_MAX_BLOCK		64				/* instructions */
#define JIT_CODEMAP_SHIFT	2				/* host address granules of 4 bytes (one word), one byte each */
#define JIT_CODEMAP_BITS	22
#define JIT_CODEMAP_SIZE	(1 << JIT_CODEMAP_BITS)
#define JIT_MAX_MODULE		4096			/* synchronous WebAssembly.Module() limit on the main thread */
#define JIT_MAX_LIVE		60000			/* translated blocks before the cache starts again */

struct jit_block
{
	void *		code;			/* function table index of the block, 0 = none */
	UINT32		pc;				/* address of the first instruction */
	UINT16		len;			/* instructions (cycles) in the block, 0 = not translatable */
	UINT8		valid;
	UINT8		ramop;			/* len 0 in fast RAM: op0 is the word that was not translatable */
	UINT32		op0;
	UINT16		heat;			/* visits before the block is translated */
	UINT8		tried;			/* translation was attempted (len 0: not translatable) */
};

/*
	A block is translated on its JIT_HEAT_MIN-th visit, not the first: a
	timeslice often ends in the middle of a block (the interpreter steps
	through the last instructions), and the next one starts there, so
	most addresses are visited a few times as a block start. Compiling a
	WebAssembly module costs as much as interpreting the block a few
	hundred times; the block heads that matter are visited thousands of
	times a second.
*/
#define JIT_HEAT_MIN		32

typedef UINT32 (*jit_func)(void);

static void loop_skip_helper( UINT32 l );	/* psxloop.c */

/* the GTE, in psx_cpu.c */
static UINT32 getcp2dr( int n_reg );
static void setcp2dr( int n_reg, UINT32 n_value );
static void docop2( int gteop );
static void setcp2cr( int n_reg, UINT32 n_value );

static int jit_enabled;
static struct jit_block *jit_table;
static UINT8 *jit_codemap;
static int jit_code_present;
static UINT32 jit_flushes;
static UINT32 jit_live;				/* blocks with code since the last flush */
static int jit_failed_logged;
static int jit_tailcalls;			/* the browser has return_call_indirect: blocks chain */
static UINT32 jit_prev_pc = 0xfffffff0;	/* the last pc jit_run left to the interpreter */
static UINT32 jit_retry_pc = 0xffffffff;	/* where jit_run tries a block in straight code */

#ifdef PSXWASM_STATS
/* counts for measurement builds (Module.psxwasmCounters in the browser) */
enum { JS_CALLS, JS_BOUNDARY, JS_COLD, JS_UNTRANS, JS_NOFIT, JS_EXIT0, JS_RAN, JS_JITINSTR, JS_INTERP, JS_CHAINED, JS_COUNT };
static UINT32 jit_stat[ JS_COUNT ];
#define JIT_STAT( n, v )	( jit_stat[ ( n ) ] += ( v ) )
/* interpreted instructions by primary opcode, SPECIAL funct and COP0 rs; GTE commands by funct; */
/* then: interpreted accesses outside fast RAM, timeslices, timeslice cycles / 1024 */
enum { JSO_OP = 0, JSO_SPECIAL = 64, JSO_COP0 = 128, JSO_GTE = 160, JSO_SLOW = 224, JSO_SLICES, JSO_SLICE_KCYCLES, JSO_COUNT };
static UINT32 jit_stat_ops[ JSO_COUNT ];
static void jit_stat_interp( UINT32 op, int slow )
{
	jit_stat_ops[ JSO_OP + ( op >> 26 ) ]++;
	if( ( op >> 26 ) == 0 ) jit_stat_ops[ JSO_SPECIAL + ( op & 63 ) ]++;
	if( ( op >> 26 ) == 0x10 ) jit_stat_ops[ JSO_COP0 + ( ( op >> 21 ) & 31 ) ]++;
	if( slow ) jit_stat_ops[ JSO_SLOW ]++;
}
static void jit_stat_gte( int gteop ) { jit_stat_ops[ JSO_GTE + ( gteop & 63 ) ]++; }
static void jit_stat_slice( int cycles ) { jit_stat_ops[ JSO_SLICES ]++; jit_stat_ops[ JSO_SLICE_KCYCLES ] += cycles >> 10; }
#else
#define JIT_STAT( n, v )	do { } while( 0 )
#endif

static INLINE void mips_step( void );


/*************************************
 *  JavaScript side
 *************************************/

/* compiles and instantiates a block module; returns its function table index, 0 on failure */
EM_JS( int, psxwasm_install, ( const UINT8 *bytes, int len ), {
	try {
		var module = new WebAssembly.Module( HEAPU8.subarray( bytes, bytes + len ) );
		var instance = new WebAssembly.Instance( module, { e: { m: wasmMemory, t: wasmTable } } );
		var free = Module[ 'psxwasmFree' ] || ( Module[ 'psxwasmFree' ] = [] );
		var index = free.length ? free.pop() : wasmTable.grow( 1 );
		wasmTable.set( index, instance.exports[ 'f' ] );
		return index;
	} catch( e ) {
		if( !Module[ 'psxwasmError' ] ) {
			Module[ 'psxwasmError' ] = 1;
			err( 'PSX recompiler: ' + e );
		}
		return 0;
	}
} );

/* counts for diagnosis (Module.psxwasmStats in the browser console) */
EM_JS( void, psxwasm_note, ( int what ), {
	var s = Module[ 'psxwasmStats' ] || ( Module[ 'psxwasmStats' ] = { compiled: 0, flushes: 0, invalidated: 0, failed: 0 } );
	if( what == 0 ) s.compiled++; else if( what == 1 ) s.flushes++; else if( what == 2 ) s.invalidated++; else s.failed++;
} );

/* does the browser take tail calls (return_call_indirect)? */
EM_JS( int, psxwasm_tailcalls, (), {
	try {
		/* (module (type (func (result i32))) (table 1 funcref) (func (type 0) i32.const 0 return_call_indirect (type 0))) */
		return WebAssembly.validate( new Uint8Array( [ 0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
			4, 4, 1, 112, 0, 1, 10, 9, 1, 7, 0, 65, 0, 19, 0, 0, 11 ] ) ) ? 1 : 0;
	} catch( e ) {
		return 0;
	}
} );

#ifdef PSXWASM_STATS
EM_JS( void, psxwasm_counters, ( const UINT32 *c, int n, const UINT32 *ops, int nops ), {
	var names = [ 'calls', 'boundary', 'cold', 'untranslatable', 'nofit', 'exit0', 'ran', 'jitInstr', 'interpInstr', 'chained' ];
	var o = {};
	for( var i = 0; i < n; i++ ) o[ names[ i ] ] = HEAPU32[ ( c >> 2 ) + i ];
	o[ 'ops' ] = Array.from( HEAPU32.subarray( ops >> 2, ( ops >> 2 ) + nops ) );
	Module[ 'psxwasmCounters' ] = o;
} );
#endif

/* frees a function table index from psxwasm_install */
EM_JS( void, psxwasm_release, ( int index ), {
	wasmTable.set( index, null );
	( Module[ 'psxwasmFree' ] || ( Module[ 'psxwasmFree' ] = [] ) ).push( index );
} );


/*************************************
 *  Cache, code map, invalidation (as psxjit.c)
 *************************************/

static INLINE UINT32 jit_codemap_index( const void *host )
{
	return (UINT32)( ( (size_t)host >> JIT_CODEMAP_SHIFT ) & ( JIT_CODEMAP_SIZE - 1 ) );
}

static void jit_drop_code( struct jit_block *block )
{
	if( block->code )
	{
		psxwasm_release( (int)(size_t)block->code );
		block->code = NULL;
		if( jit_live )
		{
			jit_live--;
		}
	}
}

static void jit_flush( void )
{
	int i;

	if( !jit_table )
	{
		return;
	}
	for( i = 0; i < JIT_TABLE_SIZE; i++ )
	{
		jit_drop_code( &jit_table[ i ] );
		jit_table[ i ].valid = 0;
	}
	memset( jit_codemap, 0, JIT_CODEMAP_SIZE );
	jit_code_present = 0;
	jit_live = 0;
	jit_flushes++;
	psxwasm_note( 1 );
}

static INLINE UINT32 jit_table_index( UINT32 pc )
{
	return ( ( pc >> 2 ) ^ ( pc >> 20 ) ) & ( JIT_TABLE_SIZE - 1 );
}

/* a CPU store over translated code: drop the blocks that can contain the word (as psxjit.c) */
static void jit_invalidate_host( const void *host )
{
	int i;
	int k;

	for( i = 0; i < fastram_count; i++ )
	{
		const struct psx_fastram *r = &fastram[ i ];
		if( (const UINT8 *)host >= r->base && (const UINT8 *)host <= r->base + ( r->end - r->start ) )
		{
			UINT32 addr = ( r->start + (UINT32)( (const UINT8 *)host - r->base ) ) & ~3;
			for( k = 0; k < JIT_MAX_BLOCK; k++ )
			{
				UINT32 pc = addr - k * 4;
				struct jit_block *block = &jit_table[ jit_table_index( pc ) ];
				if( block->valid && block->pc == pc )
				{
					if( block->code )
					{
						psxwasm_note( 2 );
					}
					jit_drop_code( block );
					block->valid = 0;
				}
			}
		}
	}
}

/* called by the fast RAM write handlers */
static INLINE void psx_jit_check_write( const void *host )
{
	if( jit_code_present && jit_codemap[ jit_codemap_index( host ) ] )
	{
		jit_invalidate_host( host );
	}
}

void psxcpu_ram_written( const void *host, UINT32 bytes )
{
	size_t first, last, g;

	if( !jit_code_present || bytes == 0 )
	{
		return;
	}
	first = (size_t)host >> JIT_CODEMAP_SHIFT;
	last = ( (size_t)host + bytes - 1 ) >> JIT_CODEMAP_SHIFT;
	if( last - first >= JIT_CODEMAP_SIZE )
	{
		jit_flush();
		return;
	}
	for( g = first; g <= last; g++ )
	{
		if( jit_codemap[ g & ( JIT_CODEMAP_SIZE - 1 ) ] )
		{
			jit_flush();
			return;
		}
	}
}

static void jit_exit( void )
{
	jit_flush();
	free( jit_table );
	free( jit_codemap );
	jit_table = NULL;
	jit_codemap = NULL;
	jit_enabled = 0;
}

static void jit_init( void )
{
	jit_table = calloc( JIT_TABLE_SIZE, sizeof( jit_table[ 0 ] ) );
	jit_codemap = calloc( JIT_CODEMAP_SIZE, 1 );
	if( !jit_table || !jit_codemap )
	{
		free( jit_table );
		free( jit_codemap );
		jit_table = NULL;
		jit_codemap = NULL;
		jit_enabled = 0;
		return;
	}
	jit_code_present = 0;
	jit_flushes = 0;
	jit_live = 0;
	jit_tailcalls = psxwasm_tailcalls();
	jit_prev_pc = 0xfffffff0;
	jit_retry_pc = 0xffffffff;
}


/*************************************
 *  Instruction decoding (as psxjit.c)
 *************************************/

enum
{
	JIT_NONE = 0,		/* not translatable */
	JIT_SIMPLE,			/* native, falls through */
	JIT_MEM,			/* native load or store, falls through (may side exit) */
	JIT_HELPER,			/* the interpreter runs it, falls through */
	JIT_HELPER_MEM,		/* the interpreter runs it, after an address check */
	JIT_BRANCH			/* jump or branch (needs a delay slot) */
};

struct jit_op
{
	int			kind;
	UINT32		reads;			/* general registers read (bit mask) */
	UINT32		writes;			/* general registers written (bit mask, r0 excluded) */
	int			dload;			/* register of a delayed load (load, MFC0/MFC2/CFC2), or 0 */
	int			size;			/* memory access size (aligned word for LWL & co) */
	int			align;			/* address bits that must be clear */
	int			store;			/* writes memory */
	int			cop2;			/* needs COP2 enabled */
	int			trap;			/* ADD/ADDI/SUB: overflow exception */
	int			hilo;			/* writes HI/LO */
};

#define JBIT( r )		( (UINT32)1 << ( r ) )

static void jit_decode( UINT32 op, struct jit_op *o )
{
	int rs = INS_RS( op ), rt = INS_RT( op ), rd = INS_RD( op );

	memset( o, 0, sizeof( *o ) );
	switch( INS_OP( op ) )
	{
	case OP_SPECIAL:
		switch( INS_FUNCT( op ) )
		{
		case FUNCT_SLL: case FUNCT_SRL: case FUNCT_SRA:
			o->kind = JIT_SIMPLE; o->reads = JBIT( rt ); o->writes = JBIT( rd );
			break;
		case FUNCT_SLLV: case FUNCT_SRLV: case FUNCT_SRAV:
			o->kind = JIT_SIMPLE; o->reads = JBIT( rt ) | JBIT( rs ); o->writes = JBIT( rd );
			break;
		case FUNCT_JR:
			if( rd == 0 ) { o->kind = JIT_BRANCH; o->reads = JBIT( rs ); }
			break;
		case FUNCT_JALR:
			o->kind = JIT_BRANCH; o->reads = JBIT( rs ); o->writes = JBIT( rd );
			break;
		case FUNCT_MFHI: case FUNCT_MFLO:
			o->kind = JIT_SIMPLE; o->writes = JBIT( rd );
			break;
		case FUNCT_MTHI: case FUNCT_MTLO:
			if( rd == 0 ) { o->kind = JIT_SIMPLE; o->reads = JBIT( rs ); o->hilo = 1; }
			break;
		case FUNCT_MULT: case FUNCT_MULTU:
			if( rd == 0 ) { o->kind = JIT_SIMPLE; o->reads = JBIT( rs ) | JBIT( rt ); o->hilo = 1; }
			break;
		case FUNCT_DIV: case FUNCT_DIVU:
			if( rd == 0 ) { o->kind = JIT_HELPER; o->reads = JBIT( rs ) | JBIT( rt ); o->hilo = 1; }
			break;
		case FUNCT_ADD: case FUNCT_SUB:
			o->trap = 1;
			/* fall through */
		case FUNCT_ADDU: case FUNCT_SUBU: case FUNCT_AND: case FUNCT_OR:
		case FUNCT_XOR: case FUNCT_NOR: case FUNCT_SLT: case FUNCT_SLTU:
			o->kind = JIT_SIMPLE; o->reads = JBIT( rs ) | JBIT( rt ); o->writes = JBIT( rd );
			break;
		}
		break;

	case OP_REGIMM:
		switch( rt )
		{
		case RT_BLTZ: case RT_BGEZ:
			o->kind = JIT_BRANCH; o->reads = JBIT( rs );
			break;
		case RT_BLTZAL: case RT_BGEZAL:
			o->kind = JIT_BRANCH; o->reads = JBIT( rs ); o->writes = JBIT( 31 );
			break;
		}
		break;

	case OP_J:
		o->kind = JIT_BRANCH;
		break;
	case OP_JAL:
		o->kind = JIT_BRANCH; o->writes = JBIT( 31 );
		break;
	case OP_BEQ: case OP_BNE:
		o->kind = JIT_BRANCH; o->reads = JBIT( rs ) | JBIT( rt );
		break;
	case OP_BLEZ: case OP_BGTZ:
		/* rt != 0 is a reserved instruction for the interpreter */
		if( rt == 0 ) { o->kind = JIT_BRANCH; o->reads = JBIT( rs ); }
		break;

	case OP_ADDI:
		o->trap = 1;
		/* fall through */
	case OP_ADDIU: case OP_SLTI: case OP_SLTIU:
	case OP_ANDI: case OP_ORI: case OP_XORI:
		o->kind = JIT_SIMPLE; o->reads = JBIT( rs ); o->writes = JBIT( rt );
		break;
	case OP_LUI:
		o->kind = JIT_SIMPLE; o->writes = JBIT( rt );
		break;

	case OP_COP0:
		if( rs == RS_MFC )
		{
			o->kind = JIT_HELPER; o->writes = JBIT( rt ); o->dload = rt;
		}
		break;

	case OP_COP2:
		o->cop2 = 1;
		switch( rs )
		{
		case RS_MFC: case RS_CFC:
			o->kind = JIT_HELPER; o->writes = JBIT( rt ); o->dload = rt;
			break;
		case RS_MTC: case RS_CTC:
			o->kind = JIT_HELPER; o->reads = JBIT( rt );
			break;
		default:
			if( INS_CO( op ) )
			{
				o->kind = JIT_HELPER;
			}
			break;
		}
		break;

	case OP_LB: case OP_LBU:
		o->kind = JIT_MEM; o->reads = JBIT( rs ); o->writes = JBIT( rt ); o->dload = rt; o->size = 1;
		break;
	case OP_LH: case OP_LHU:
		o->kind = JIT_MEM; o->reads = JBIT( rs ); o->writes = JBIT( rt ); o->dload = rt; o->size = 2; o->align = 1;
		break;
	case OP_LW:
		o->kind = JIT_MEM; o->reads = JBIT( rs ); o->writes = JBIT( rt ); o->dload = rt; o->size = 4; o->align = 3;
		break;
	case OP_LWL: case OP_LWR:
		o->kind = JIT_HELPER_MEM; o->reads = JBIT( rs ) | JBIT( rt ); o->writes = JBIT( rt ); o->dload = rt; o->size = 4;
		break;
	case OP_SB:
		o->kind = JIT_MEM; o->reads = JBIT( rs ) | JBIT( rt ); o->size = 1; o->store = 1;
		break;
	case OP_SH:
		o->kind = JIT_MEM; o->reads = JBIT( rs ) | JBIT( rt ); o->size = 2; o->align = 1; o->store = 1;
		break;
	case OP_SW:
		o->kind = JIT_MEM; o->reads = JBIT( rs ) | JBIT( rt ); o->size = 4; o->align = 3; o->store = 1;
		break;
	case OP_SWL: case OP_SWR:
		o->kind = JIT_HELPER_MEM; o->reads = JBIT( rs ) | JBIT( rt ); o->size = 4; o->store = 1;
		break;
	case OP_LWC2:
		o->kind = JIT_HELPER_MEM; o->reads = JBIT( rs ); o->size = 4; o->align = 3; o->cop2 = 1;
		break;
	case OP_SWC2:
		o->kind = JIT_HELPER_MEM; o->reads = JBIT( rs ); o->size = 4; o->align = 3; o->store = 1; o->cop2 = 1;
		break;
	}
	o->writes &= ~1;
}


/*************************************
 *  Helpers called from translated code (as psxjit.c)
 *************************************/

/* the interpreter runs one instruction (no exception possible, fast RAM only) */
static void jit_helper_step( UINT32 op )
{
	mipscpu.op = op;
	mips_step();
}

static void jit_gte_mfc2( UINT32 op )
{
	UINT32 v = getcp2dr( INS_RD( op ) );
	if( INS_RT( op ) != 0 )
	{
		mipscpu.r[ INS_RT( op ) ] = v;
	}
}

static void jit_gte_mtc2( UINT32 op )
{
	setcp2dr( INS_RD( op ), mipscpu.r[ INS_RT( op ) ] );
}

static void jit_gte_ctc2( UINT32 op )
{
	setcp2cr( INS_RD( op ), mipscpu.r[ INS_RT( op ) ] );
}

static void jit_gte_cmd( UINT32 op )
{
	docop2( INS_COFUN( op ) );
}

static void jit_gte_lwc2( UINT32 op, UINT32 host )
{
	setcp2dr( INS_RT( op ), *(UINT32 *)(size_t)host );
}

static void jit_gte_swc2( UINT32 op, UINT32 host )
{
	*(UINT32 *)(size_t)host = getcp2dr( INS_RT( op ) );
}

/* getcp2dr / setcp2dr do more than read / store this data register */
static int jit_gte_dr_special_get( int n )
{
	return n == 1 || n == 3 || n == 5 || n == 7 || ( n >= 8 && n <= 11 ) || ( n >= 15 && n <= 19 ) || n == 28 || n == 29;
}
static int jit_gte_dr_special_set( int n )
{
	return n == 15 || n == 28 || n == 30 || n == 31;
}
/* setcp2cr sign extends or masks this control register */
static int jit_gte_cr_special_set( int n )
{
	return n == 4 || n == 12 || n == 20 || n == 26 || n == 27 || n == 29 || n == 30 || n == 31;
}

#ifdef PSXJIT_VERIFY
static void jit_verify_log_store( UINT32 host, UINT32 size )
{
	if( jit_vlog_count < PSXJIT_VLOG )
	{
		jit_vlog[ jit_vlog_count ].p = (UINT8 *)(size_t)host;
		jit_vlog[ jit_vlog_count ].size = size;
		memcpy( &jit_vlog[ jit_vlog_count ].old, (void *)(size_t)host, size );
		jit_vlog_count++;
	}
}
#endif


/*************************************
 *  WebAssembly emission
 *************************************/

/* opcodes */
#define W_UNREACHABLE	0x00
#define W_BLOCK			0x02
#define W_LOOP			0x03
#define W_IF			0x04
#define W_ELSE			0x05
#define W_END			0x0b
#define W_BR			0x0c
#define W_BR_TABLE		0x0e
#define W_RETURN		0x0f
#define W_CALL_INDIRECT	0x11
#define W_RETURN_CALL_INDIRECT	0x13
#define W_DROP			0x1a
#define W_LOCAL_GET		0x20
#define W_LOCAL_SET		0x21
#define W_LOCAL_TEE		0x22
#define W_I32_LOAD		0x28
#define W_I32_LOAD8_S	0x2c
#define W_I32_LOAD8_U	0x2d
#define W_I32_LOAD16_S	0x2e
#define W_I32_LOAD16_U	0x2f
#define W_I32_STORE		0x36
#define W_I32_STORE8	0x3a
#define W_I32_STORE16	0x3b
#define W_I32_CONST		0x41
#define W_I32_EQZ		0x45
#define W_I32_EQ		0x46
#define W_I32_NE		0x47
#define W_I32_LT_S		0x48
#define W_I32_LT_U		0x49
#define W_I32_GT_S		0x4a
#define W_I32_LE_S		0x4c
#define W_I32_LE_U		0x4d
#define W_I32_GE_S		0x4e
#define W_I32_ADD		0x6a
#define W_I32_SUB		0x6b
#define W_I32_MUL		0x6c
#define W_I32_REM_U		0x70
#define W_I32_AND		0x71
#define W_I32_OR		0x72
#define W_I32_XOR		0x73
#define W_I32_SHL		0x74
#define W_I32_SHR_S		0x75
#define W_I32_SHR_U		0x76
#define W_I64_MUL		0x7e
#define W_I64_SHR_U		0x88
#define W_I32_WRAP_I64	0xa7
#define W_I64_EXTEND_S	0xac
#define W_I64_EXTEND_U	0xad
#define W_VOID			0x40

/* function types of the block module */
#define WT_BLOCK		0		/* () -> i32 */
#define WT_V1			1		/* (i32) -> () */
#define WT_V2			2		/* (i32, i32) -> () */

/* locals: the general registers a block uses, then these */
enum
{
	WL_HI = 32, WL_LO, WL_PC, WL_STATE, WL_ADDR, WL_HOST, WL_SHOST, WL_T, WL_COND, WL_DLOAD, WL_CHAIN,
	WL_COUNT32,
	WL_T64 = WL_COUNT32,	/* the one i64 local */
	WL_COUNT
};

#define W_BODY_MAX		16384

static UINT8 w_body[ W_BODY_MAX ];
static int w_len;
static int w_overflow;
static int w_level;				/* open blocks, loops and ifs */
static int w_local[ WL_COUNT ];	/* local index of a register / WL_*, -1 if none */

static INLINE void w_byte( UINT8 b )
{
	if( w_len < W_BODY_MAX )
	{
		w_body[ w_len++ ] = b;
	}
	else
	{
		w_overflow = 1;
	}
}

static void w_u32( UINT32 v )
{
	do
	{
		UINT8 b = v & 0x7f;
		v >>= 7;
		w_byte( v ? ( b | 0x80 ) : b );
	} while( v );
}

static void w_s32( INT32 v )
{
	int more = 1;
	while( more )
	{
		UINT8 b = v & 0x7f;
		v >>= 7;	/* arithmetic shift */
		if( ( v == 0 && !( b & 0x40 ) ) || ( v == -1 && ( b & 0x40 ) ) )
		{
			more = 0;
		}
		else
		{
			b |= 0x80;
		}
		w_byte( b );
	}
}

static void w_const( UINT32 v )			{ w_byte( W_I32_CONST ); w_s32( (INT32)v ); }
static void w_get( int local )			{ w_byte( W_LOCAL_GET ); w_u32( w_local[ local ] ); }
static void w_set( int local )			{ w_byte( W_LOCAL_SET ); w_u32( w_local[ local ] ); }
static void w_tee( int local )			{ w_byte( W_LOCAL_TEE ); w_u32( w_local[ local ] ); }

/* memory access at a constant address (i32.const 0, offset = address) */
static void w_memop( UINT8 op, int align, UINT32 offset )
{
	w_byte( op );
	w_u32( align );
	w_u32( offset );
}
static void w_load_abs( UINT32 address )
{
	w_const( 0 );
	w_memop( W_I32_LOAD, 2, address );
}
/* stores the value computed by 'value' (already on the stack after i32.const 0) */
#define W_STORE_ABS( address, value ) do { w_const( 0 ); value; w_memop( W_I32_STORE, 2, ( address ) ); } while( 0 )

static void w_open( UINT8 kind )
{
	w_byte( kind );
	w_byte( W_VOID );
	w_level++;
}
static void w_end( void )
{
	w_byte( W_END );
	w_level--;
}
/* branch to the construct opened at 'level' (w_level just after it was opened) */
static void w_br( int level )
{
	w_byte( W_BR );
	w_u32( w_level - level );
}

#define R_ADDR( n )		( (UINT32)(size_t)&mipscpu.r[ ( n ) ] )
#define HI_ADDR			( (UINT32)(size_t)&mipscpu.hi )
#define LO_ADDR			( (UINT32)(size_t)&mipscpu.lo )
#define DELAYR_ADDR		( (UINT32)(size_t)&mipscpu.delayr )
#define DELAYV_ADDR		( (UINT32)(size_t)&mipscpu.delayv )
#define SR_ADDR			( (UINT32)(size_t)&mipscpu.cp0r[ CP0_SR ] )
#define CP2DR_ADDR( n )	( (UINT32)(size_t)&mipscpu.cp2dr[ ( n ) ].d )
#define CP2CR_ADDR( n )	( (UINT32)(size_t)&mipscpu.cp2cr[ ( n ) ].d )
#define ICOUNT_ADDR		( (UINT32)(size_t)&mips_ICount )
#define FN( f )			( (UINT32)(size_t)( f ) )

/* a general register's value onto the stack */
static void w_getr( int n )
{
	if( n == 0 )
	{
		w_const( 0 );
	}
	else
	{
		w_get( n );
	}
}

/* the value on the stack into a general register (r0 discards it) */
static void w_setr( int n )
{
	if( n == 0 )
	{
		w_byte( W_DROP );
	}
	else
	{
		w_set( n );
	}
}

static void w_call( UINT32 type, UINT32 fn )
{
	w_const( fn );
	w_byte( W_CALL_INDIRECT );
	w_u32( type );
	w_byte( 0 );	/* table 0 */
}


/*************************************
 *  Block translation context
 *************************************/

struct jit_ctx
{
	UINT32		pc;				/* address of the first instruction */
	UINT32		count;			/* instructions in the block */
	UINT32		acct;			/* instruction up to which cycles are already taken */
	UINT8		target[ JIT_MAX_BLOCK ];	/* instruction n is a jump target in the block */
	UINT8		idle[ JIT_MAX_BLOCK ];		/* branch n closes a polling loop */
	int			seg[ JIT_MAX_BLOCK ];		/* dispatch number of a jump target */
	int			nseg;
	int			dispatch;		/* some branch jumps to an earlier or later instruction of the block */
	int			out_level;		/* the block everything leaves through */
	int			loop_level;		/* the dispatch loop (dispatch) */
	UINT32		used;			/* general registers in locals */
	UINT32		written;		/* general registers the block may write */
	int			hilo;			/* HI/LO in locals */
};

static struct jit_ctx ctx;

/* stores the registers that may differ from mipscpu (before a helper and on the way out) */
static void w_flush( UINT32 mask, int hilo )
{
	int n;
	for( n = 1; n < 32; n++ )
	{
		if( mask & ctx.written & JBIT( n ) )
		{
			W_STORE_ABS( R_ADDR( n ), w_get( n ) );
		}
	}
	if( hilo && ctx.hilo )
	{
		W_STORE_ABS( HI_ADDR, w_get( WL_HI ) );
		W_STORE_ABS( LO_ADDR, w_get( WL_LO ) );
	}
}

/* loads registers a helper may have changed */
static void w_reload( UINT32 mask, int hilo )
{
	int n;
	for( n = 1; n < 32; n++ )
	{
		if( mask & ctx.used & JBIT( n ) )
		{
			w_load_abs( R_ADDR( n ) );
			w_set( n );
		}
	}
	if( hilo && ctx.hilo )
	{
		w_load_abs( HI_ADDR );
		w_set( WL_HI );
		w_load_abs( LO_ADDR );
		w_set( WL_LO );
	}
}

/* mips_ICount -= cycles */
static void w_cycles( UINT32 cycles )
{
	if( cycles )
	{
		w_const( 0 );
		w_load_abs( ICOUNT_ADDR );
		w_const( cycles );
		w_byte( W_I32_SUB );
		w_memop( W_I32_STORE, 2, ICOUNT_ADDR );
	}
}

/* take the cycles of the instructions up to 'index' from the timeslice */
static void jit_emit_cycles_to( UINT32 index )
{
	w_cycles( index - ctx.acct );
}

/* side exit: leave before instruction 'index'; the interpreter runs it */
static void jit_emit_exit( UINT32 index )
{
	w_cycles( index - ctx.acct );
	w_const( ctx.pc + index * 4 );
	w_set( WL_PC );
	w_br( ctx.out_level );
}

/* side exit when the value on the stack is not zero */
static void jit_emit_exit_if( UINT32 index )
{
	w_open( W_IF );
	jit_emit_exit( index );
	w_end();
}

/* rd = rs <op> rt (or immediate, pushed by the caller as 'rhs') */
#define W_ALU( rd, lhs, rhs, opcode ) do { if( rd ) { lhs; rhs; w_byte( opcode ); w_setr( rd ); } } while( 0 )

/* ADD/ADDI/SUB: leave before the instruction on overflow, otherwise as ADDU/ADDIU/SUBU */
static void jit_emit_overflow_check( int sub, int rs, int rt_or_minus1, INT32 imm, UINT32 index )
{
	/* sum = a + b; overflow if ((a ^ sum) & (b ^ sum)) < 0; for a - b: ((a ^ b) & (a ^ diff)) < 0 */
	w_getr( rs );
	if( rt_or_minus1 >= 0 ) w_getr( rt_or_minus1 ); else w_const( (UINT32)imm );
	w_byte( sub ? W_I32_SUB : W_I32_ADD );
	w_set( WL_T );
	if( !sub )
	{
		w_getr( rs ); w_get( WL_T ); w_byte( W_I32_XOR );
		if( rt_or_minus1 >= 0 ) w_getr( rt_or_minus1 ); else w_const( (UINT32)imm );
		w_get( WL_T ); w_byte( W_I32_XOR );
		w_byte( W_I32_AND );
	}
	else
	{
		w_getr( rs ); w_getr( rt_or_minus1 ); w_byte( W_I32_XOR );
		w_getr( rs ); w_get( WL_T ); w_byte( W_I32_XOR );
		w_byte( W_I32_AND );
	}
	w_const( 0 );
	w_byte( W_I32_LT_S );
	jit_emit_exit_if( index );
}

/* COP2 instructions raise an exception when COP2 is disabled: leave first */
static void jit_check_cop2( UINT32 index )
{
	w_load_abs( SR_ADDR );
	w_const( SR_CU2 );
	w_byte( W_I32_AND );
	w_byte( W_I32_EQZ );
	jit_emit_exit_if( index );
}

static void jit_emit_simple( UINT32 op )
{
	int rs = INS_RS( op ), rt = INS_RT( op ), rd = INS_RD( op ), sa = INS_SHAMT( op );

	switch( INS_OP( op ) )
	{
	case OP_SPECIAL:
		switch( INS_FUNCT( op ) )
		{
		case FUNCT_SLL:		W_ALU( rd, w_getr( rt ), w_const( sa ), W_I32_SHL ); break;
		case FUNCT_SRL:		W_ALU( rd, w_getr( rt ), w_const( sa ), W_I32_SHR_U ); break;
		case FUNCT_SRA:		W_ALU( rd, w_getr( rt ), w_const( sa ), W_I32_SHR_S ); break;
		/* WebAssembly shifts by the count modulo 32, as the interpreter's & 31 */
		case FUNCT_SLLV:	W_ALU( rd, w_getr( rt ), w_getr( rs ), W_I32_SHL ); break;
		case FUNCT_SRLV:	W_ALU( rd, w_getr( rt ), w_getr( rs ), W_I32_SHR_U ); break;
		case FUNCT_SRAV:	W_ALU( rd, w_getr( rt ), w_getr( rs ), W_I32_SHR_S ); break;
		case FUNCT_MFHI:	if( rd ) { w_get( WL_HI ); w_setr( rd ); } break;
		case FUNCT_MFLO:	if( rd ) { w_get( WL_LO ); w_setr( rd ); } break;
		case FUNCT_MTHI:	w_getr( rs ); w_set( WL_HI ); break;
		case FUNCT_MTLO:	w_getr( rs ); w_set( WL_LO ); break;
		case FUNCT_MULT:
		case FUNCT_MULTU:
			{
				UINT8 ext = ( INS_FUNCT( op ) == FUNCT_MULT ) ? W_I64_EXTEND_S : W_I64_EXTEND_U;
				w_getr( rs ); w_byte( ext );
				w_getr( rt ); w_byte( ext );
				w_byte( W_I64_MUL );
				w_byte( W_LOCAL_TEE ); w_u32( w_local[ WL_T64 ] );
				w_byte( W_I32_WRAP_I64 ); w_set( WL_LO );
				w_byte( W_LOCAL_GET ); w_u32( w_local[ WL_T64 ] );
				w_byte( 0x42 ); w_s32( 32 );	/* i64.const 32 */
				w_byte( W_I64_SHR_U );
				w_byte( W_I32_WRAP_I64 ); w_set( WL_HI );
			}
			break;
		case FUNCT_ADD:
		case FUNCT_ADDU:	W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_ADD ); break;
		case FUNCT_SUB:
		case FUNCT_SUBU:	W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_SUB ); break;
		case FUNCT_AND:		W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_AND ); break;
		case FUNCT_OR:		W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_OR ); break;
		case FUNCT_XOR:		W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_XOR ); break;
		case FUNCT_NOR:
			if( rd ) { w_getr( rs ); w_getr( rt ); w_byte( W_I32_OR ); w_const( 0xffffffff ); w_byte( W_I32_XOR ); w_setr( rd ); }
			break;
		case FUNCT_SLT:		W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_LT_S ); break;
		case FUNCT_SLTU:	W_ALU( rd, w_getr( rs ), w_getr( rt ), W_I32_LT_U ); break;
		}
		break;

	case OP_ADDI:
	case OP_ADDIU:	W_ALU( rt, w_getr( rs ), w_const( (UINT32)MIPS_WORD_EXTEND( INS_IMMEDIATE( op ) ) ), W_I32_ADD ); break;
	case OP_SLTI:	W_ALU( rt, w_getr( rs ), w_const( (UINT32)MIPS_WORD_EXTEND( INS_IMMEDIATE( op ) ) ), W_I32_LT_S ); break;
	/* against the sign-extended immediate */
	case OP_SLTIU:	W_ALU( rt, w_getr( rs ), w_const( (UINT32)MIPS_WORD_EXTEND( INS_IMMEDIATE( op ) ) ), W_I32_LT_U ); break;
	case OP_ANDI:	W_ALU( rt, w_getr( rs ), w_const( INS_IMMEDIATE( op ) ), W_I32_AND ); break;
	case OP_ORI:	W_ALU( rt, w_getr( rs ), w_const( INS_IMMEDIATE( op ) ), W_I32_OR ); break;
	case OP_XORI:	W_ALU( rt, w_getr( rs ), w_const( INS_IMMEDIATE( op ) ), W_I32_XOR ); break;
	case OP_LUI:
		if( rt ) { w_const( INS_IMMEDIATE( op ) << 16 ); w_setr( rt ); }
		break;
	}
}

/* a simple instruction at 'index' (ADD/ADDI/SUB check for overflow first) */
static void jit_emit_simple_at( UINT32 op, UINT32 index, int checked )
{
	struct jit_op o;
	jit_decode( op, &o );
	if( o.trap && !checked )
	{
		if( INS_OP( op ) == OP_ADDI )
			jit_emit_overflow_check( 0, INS_RS( op ), -1, MIPS_WORD_EXTEND( INS_IMMEDIATE( op ) ), index );
		else
			jit_emit_overflow_check( INS_FUNCT( op ) == FUNCT_SUB, INS_RS( op ), INS_RT( op ), 0, index );
	}
	jit_emit_simple( op );
}


/*************************************
 *  Loads and stores
 *************************************/

/*
	The usual PSX map has main RAM at 0x00000000 with mirrors at
	0x80000000 and 0xa0000000 (one host buffer): one check covers the
	three, address & 0x1fffffff with the top three bits 000, 100 or 101.
	Returns the RAM size when the fast RAM regions have that layout, else 0.
*/
static UINT32 jit_ram_mirrors( void )
{
	static const UINT32 starts[ 3 ] = { 0x00000000, 0x80000000, 0xa0000000 };
	const struct psx_fastram *first = NULL;
	int i, k;

	for( k = 0; k < 3; k++ )
	{
		const struct psx_fastram *r = NULL;
		for( i = 0; i < fastram_count; i++ )
		{
			if( fastram[ i ].start == starts[ k ] )
			{
				r = &fastram[ i ];
			}
		}
		if( !r || r->readonly || r->end - r->start >= 0x1fffffff )
		{
			return 0;
		}
		if( first && ( r->base != first->base || r->end - r->start != first->end - first->start ) )
		{
			return 0;
		}
		first = r;
	}
	return first->end - first->start + 1;
}

static int jit_is_ram_mirror( const struct psx_fastram *r, UINT32 ram_size )
{
	return ram_size && ( r->start == 0x00000000 || r->start == 0x80000000 || r->start == 0xa0000000 );
}

/*
	Host address of the access of 'op' into 'host_local', or a side exit
	before 'index': the whole access must be in one fast RAM region
	(writable for a store), aligned as the interpreter requires, and a
	store must not touch translated code. LWL & co check their aligned word.
*/
static void jit_emit_mem_address( UINT32 op, const struct jit_op *o, UINT32 index, int host_local )
{
	const UINT32 ram_size = jit_ram_mirrors();
	int i, found_level;

	w_getr( INS_RS( op ) );
	w_const( (UINT32)MIPS_WORD_EXTEND( INS_IMMEDIATE( op ) ) );
	w_byte( W_I32_ADD );
	w_set( WL_ADDR );
	if( o->align )
	{
		w_get( WL_ADDR ); w_const( o->align ); w_byte( W_I32_AND );
		jit_emit_exit_if( index );
	}
	if( o->kind == JIT_HELPER_MEM && !o->align )
	{
		w_get( WL_ADDR ); w_const( 0xfffffffc ); w_byte( W_I32_AND ); w_set( WL_ADDR );
	}

	/* host = base + ( addr - start ), from the first region that holds the whole access */
	w_open( W_BLOCK );
	found_level = w_level;
	if( ram_size >= (UINT32)o->size )
	{
		/* main RAM and its mirrors */
		const struct psx_fastram *ram = NULL;
		for( i = 0; i < fastram_count; i++ )
		{
			if( fastram[ i ].start == 0x80000000 )
			{
				ram = &fastram[ i ];
			}
		}
		w_get( WL_ADDR ); w_const( 0x1fffffff ); w_byte( W_I32_AND ); w_tee( WL_T );
		w_const( ram_size - o->size ); w_byte( W_I32_LE_U );
		w_const( 0x31 ); w_get( WL_ADDR ); w_const( 29 ); w_byte( W_I32_SHR_U ); w_byte( W_I32_SHR_U );
		w_const( 1 ); w_byte( W_I32_AND );
		w_byte( W_I32_AND );
		w_open( W_IF );
		w_get( WL_T ); w_const( (UINT32)(size_t)ram->base ); w_byte( W_I32_ADD ); w_set( host_local );
		w_br( found_level );
		w_end();
	}
	for( i = 0; i < fastram_count; i++ )
	{
		if( fastram[ i ].end - fastram[ i ].start + 1 < (UINT32)o->size || jit_is_ram_mirror( &fastram[ i ], ram_size ) )
		{
			continue;
		}
		if( fastram[ i ].readonly && o->store )
		{
			continue;
		}
		w_get( WL_ADDR ); w_const( fastram[ i ].start ); w_byte( W_I32_SUB ); w_tee( WL_T );
		w_const( fastram[ i ].end - fastram[ i ].start - ( o->size - 1 ) );
		w_byte( W_I32_LE_U );
		w_open( W_IF );
		w_get( WL_T ); w_const( (UINT32)(size_t)fastram[ i ].base ); w_byte( W_I32_ADD ); w_set( host_local );
		w_br( found_level );
		w_end();
	}
	/* not fast RAM: let the interpreter do it */
	jit_emit_exit( index );
	w_end();

	/* a store over translated code: let the interpreter do it (and flush) */
	if( o->store )
	{
		w_get( host_local ); w_const( JIT_CODEMAP_SHIFT ); w_byte( W_I32_SHR_U );
		w_const( JIT_CODEMAP_SIZE - 1 ); w_byte( W_I32_AND );
		w_memop( W_I32_LOAD8_U, 0, (UINT32)(size_t)jit_codemap );
		jit_emit_exit_if( index );
	}
}

#ifdef PSXJIT_VERIFY
static void jit_emit_verify_log( int host_local, int size )
{
	w_get( host_local );
	w_const( size );
	w_call( WT_V2, FN( jit_verify_log_store ) );
}
#endif

/*
	The access through the host pointer in 'host_local'. A load writes its
	register (r0 discarded), or, with 'pending', leaves the value in WL_DLOAD.
*/
static void jit_emit_mem_access( UINT32 op, int host_local, int pending )
{
	int rt = INS_RT( op );
	UINT8 load = 0;

	switch( INS_OP( op ) )
	{
	case OP_LB:		load = W_I32_LOAD8_S;	break;
	case OP_LH:		load = W_I32_LOAD16_S;	break;
	case OP_LW:		load = W_I32_LOAD;		break;
	case OP_LBU:	load = W_I32_LOAD8_U;	break;
	case OP_LHU:	load = W_I32_LOAD16_U;	break;
	case OP_SB:
	case OP_SH:
	case OP_SW:
		{
			int size = ( INS_OP( op ) == OP_SB ) ? 1 : ( INS_OP( op ) == OP_SH ) ? 2 : 4;
#ifdef PSXJIT_VERIFY
			jit_emit_verify_log( host_local, size );
#endif
			w_get( host_local );
			w_getr( rt );
			w_memop( size == 1 ? W_I32_STORE8 : size == 2 ? W_I32_STORE16 : W_I32_STORE, 0, 0 );
		}
		return;
	}

	w_get( host_local );
	w_memop( load, 0, 0 );
	if( pending )
	{
		w_set( WL_DLOAD );
	}
	else
	{
		w_setr( rt );
	}
}


/*************************************
 *  Helpers (the interpreter for one instruction, the GTE)
 *************************************/

static void jit_emit_call1( UINT32 op, void *fn, UINT32 flush, UINT32 reload, int hilo )
{
	w_flush( flush, 0 );
	w_const( op );
	w_call( WT_V1, FN( fn ) );
	w_reload( reload, hilo );
}

/*
	A GTE instruction, or one of the other helpers. 'host_local' holds the
	checked fast RAM address of LWC2/SWC2 (and of LWL & co, for verify).
*/
static void jit_emit_helper_op( UINT32 op, const struct jit_op *o, int host_local )
{
	int rt = INS_RT( op ), rd = INS_RD( op );

	if( INS_OP( op ) == OP_COP2 )
	{
		switch( INS_RS( op ) )
		{
		case RS_MFC:
			if( jit_gte_dr_special_get( rd ) )
			{
				jit_emit_call1( op, (void *)jit_gte_mfc2, 0, JBIT( rt ), 0 );
			}
			else if( rt )
			{
				w_load_abs( CP2DR_ADDR( rd ) );
				w_setr( rt );
			}
			return;
		case RS_CFC:
			if( rt )
			{
				w_load_abs( CP2CR_ADDR( rd ) );
				w_setr( rt );
			}
			return;
		case RS_MTC:
			if( jit_gte_dr_special_set( rd ) )
			{
				jit_emit_call1( op, (void *)jit_gte_mtc2, JBIT( rt ), 0, 0 );
			}
			else
			{
				W_STORE_ABS( CP2DR_ADDR( rd ), w_getr( rt ) );
			}
			return;
		case RS_CTC:
			if( jit_gte_cr_special_set( rd ) )
			{
				jit_emit_call1( op, (void *)jit_gte_ctc2, JBIT( rt ), 0, 0 );
			}
			else
			{
				W_STORE_ABS( CP2CR_ADDR( rd ), w_getr( rt ) );
			}
			return;
		default:
			if( INS_RS( op ) >= 16 && INS_CO( op ) == 1 )
			{
				jit_emit_call1( op, (void *)jit_gte_cmd, 0, 0, 0 );
				return;
			}
			break;
		}
	}
	else if( INS_OP( op ) == OP_LWC2 || INS_OP( op ) == OP_SWC2 )
	{
#ifdef PSXJIT_VERIFY
		if( INS_OP( op ) == OP_SWC2 ) jit_emit_verify_log( host_local, 4 );
#endif
		w_const( op );
		w_get( host_local );
		w_call( WT_V2, FN( INS_OP( op ) == OP_LWC2 ? (void *)jit_gte_lwc2 : (void *)jit_gte_swc2 ) );
		return;
	}
#ifdef PSXJIT_VERIFY
	if( o->store ) jit_emit_verify_log( host_local, 4 );
#endif
	/* the interpreter for this one instruction (DIV/DIVU, LWL & co, MFC0) */
	w_flush( o->reads, 1 );
	w_const( op );
	w_call( WT_V1, FN( jit_helper_step ) );
	w_reload( o->writes, o->hilo );
}


/*************************************
 *  Branches and leaving the block
 *************************************/

static UINT32 jit_branch_target( UINT32 op, UINT32 pc )
{
	if( INS_OP( op ) == OP_J || INS_OP( op ) == OP_JAL )
	{
		return ( ( pc + 4 ) & 0xf0000000 ) + ( INS_TARGET( op ) << 2 );
	}
	return pc + 4 + ( MIPS_WORD_EXTEND( INS_IMMEDIATE( op ) ) << 2 );
}

static int jit_branch_is_conditional( UINT32 op )
{
	switch( INS_OP( op ) )
	{
	case OP_REGIMM: case OP_BEQ: case OP_BNE: case OP_BLEZ: case OP_BGTZ:
		return 1;
	}
	return 0;
}

/* can 'slot' be translated as the delay slot of 'op'? (as psxjit.c) */
static int jit_slot_ok( UINT32 op, UINT32 slot )
{
	struct jit_op b, s;
	jit_decode( op, &b );
	jit_decode( slot, &s );
	switch( s.kind )
	{
	case JIT_SIMPLE:
		return !s.trap || !( s.reads & b.writes );
	case JIT_MEM:
		return !( s.reads & b.writes );
	case JIT_HELPER:
		return s.dload == 0;
	case JIT_HELPER_MEM:
		return s.dload == 0 && !( s.reads & b.writes );
	}
	return 0;
}

/* target address -> instruction index inside the block, or -1 */
static int jit_target_index( UINT32 target )
{
	if( target >= ctx.pc && target < ctx.pc + ctx.count * 4 && !( target & 3 ) )
	{
		return ( target - ctx.pc ) / 4;
	}
	return -1;
}

#define JIT_LEAVE_PLAIN		-1
#define JIT_LEAVE_OUT		-2

/*
	Leave for the target (constant 'target', or the value of WL_COND when
	'in_cond') after the instructions up to 'index'. A target inside the
	block is reached through the dispatch loop while the timeslice has
	room for the rest of the block from there; at the end of a polling
	loop the passes that still fit are skipped first. 'branch' is the
	branch instruction, JIT_LEAVE_PLAIN, or JIT_LEAVE_OUT to always return
	(a load left pending for the interpreter).
*/
static void jit_emit_leave( UINT32 index, UINT32 target, int in_cond, int branch )
{
	jit_emit_cycles_to( index );
	if( !in_cond && branch != JIT_LEAVE_OUT )
	{
		int t = jit_target_index( target );
		if( t >= 0 && ctx.target[ t ] && ctx.dispatch )
		{
			if( branch >= 0 && ctx.idle[ branch ] )
			{
				/* icount = ( icount - 1 ) % pass + 1, while icount > pass */
				UINT32 pass = index - t;
				w_load_abs( ICOUNT_ADDR ); w_const( pass ); w_byte( W_I32_GT_S );
				w_open( W_IF );
				w_const( 0 );
				w_load_abs( ICOUNT_ADDR ); w_const( 1 ); w_byte( W_I32_SUB );
				w_const( pass ); w_byte( W_I32_REM_U );
				w_const( 1 ); w_byte( W_I32_ADD );
				w_memop( W_I32_STORE, 2, ICOUNT_ADDR );
				w_end();
			}
			w_load_abs( ICOUNT_ADDR ); w_const( ctx.count - t ); w_byte( W_I32_GE_S );
			w_open( W_IF );
			w_const( ctx.seg[ t ] ); w_set( WL_STATE );
			w_br( ctx.loop_level );
			w_end();
		}
	}
	if( in_cond )
	{
		w_get( WL_COND );
	}
	else
	{
		w_const( target );
	}
	w_set( WL_PC );
	if( branch != JIT_LEAVE_OUT && jit_tailcalls )
	{
		/* a jump (or straight on): the next block may follow at once */
		w_const( 1 );
		w_set( WL_CHAIN );
	}
	w_br( ctx.out_level );
}

/* condition of a conditional branch into WL_COND (0/1) */
static void jit_emit_condition( UINT32 op )
{
	int rs = INS_RS( op ), rt = INS_RT( op );

	switch( INS_OP( op ) )
	{
	case OP_REGIMM:		/* BLTZ / BGEZ / BLTZAL / BGEZAL */
		w_getr( rs ); w_const( 0 );
		w_byte( ( rt == RT_BLTZ || rt == RT_BLTZAL ) ? W_I32_LT_S : W_I32_GE_S );
		break;
	case OP_BEQ:
		w_getr( rs ); w_getr( rt ); w_byte( W_I32_EQ );
		break;
	case OP_BNE:
		w_getr( rs ); w_getr( rt ); w_byte( W_I32_NE );
		break;
	case OP_BLEZ:
		w_getr( rs ); w_const( 0 ); w_byte( W_I32_LE_S );
		break;
	case OP_BGTZ:
		w_getr( rs ); w_const( 0 ); w_byte( W_I32_GT_S );
		break;
	}
	w_set( WL_COND );
}

/* checks of the delay slot done before the branch: side exits leave before the branch */
static void jit_emit_slot_checks( UINT32 slot, const struct jit_op *s, UINT32 index )
{
	if( s->cop2 )
	{
		jit_check_cop2( index );
	}
	if( s->kind == JIT_MEM || s->kind == JIT_HELPER_MEM )
	{
		jit_emit_mem_address( slot, s, index, WL_SHOST );
	}
	else if( s->trap )
	{
		if( INS_OP( slot ) == OP_ADDI )
			jit_emit_overflow_check( 0, INS_RS( slot ), -1, MIPS_WORD_EXTEND( INS_IMMEDIATE( slot ) ), index );
		else
			jit_emit_overflow_check( INS_FUNCT( slot ) == FUNCT_SUB, INS_RS( slot ), INS_RT( slot ), 0, index );
	}
}

/* the delay slot itself, after its checks ('pending': a load leaves its value in WL_DLOAD) */
static void jit_emit_slot( UINT32 slot, const struct jit_op *s, int pending )
{
	switch( s->kind )
	{
	case JIT_MEM:
		jit_emit_mem_access( slot, WL_SHOST, pending );
		break;
	case JIT_HELPER:
	case JIT_HELPER_MEM:
		jit_emit_helper_op( slot, s, WL_SHOST );
		break;
	default:
		/* an overflow was already checked */
		jit_emit_simple( slot );
		break;
	}
}

/* the pending load of a taken branch's slot, for the interpreter */
static void jit_emit_pending( int dload )
{
	W_STORE_ABS( DELAYV_ADDR, w_get( WL_DLOAD ) );
	W_STORE_ABS( DELAYR_ADDR, w_const( dload ) );
}

/* branch at instruction 'index' with its delay slot (as psxjit.c jit_emit_branch) */
static void jit_emit_branch( UINT32 op, UINT32 slot, UINT32 index )
{
	struct jit_op s;
	UINT32 pc = ctx.pc + index * 4;
	UINT32 next = pc + 8;
	UINT32 target = jit_branch_target( op, pc );
	int dload;

	jit_decode( slot, &s );
	dload = ( s.kind == JIT_MEM ) ? s.dload : 0;		/* r0 too: delayr = 0 then */

	jit_emit_slot_checks( slot, &s, index );

	switch( INS_OP( op ) )
	{
	case OP_SPECIAL:	/* JR / JALR: an unaligned target raises an exception */
		w_getr( INS_RS( op ) ); w_set( WL_COND );
		w_get( WL_COND ); w_const( 3 ); w_byte( W_I32_AND );
		jit_emit_exit_if( index );
		if( INS_FUNCT( op ) == FUNCT_JALR && INS_RD( op ) != 0 )
		{
			w_const( next ); w_setr( INS_RD( op ) );
		}
		break;
	case OP_J:
		break;
	case OP_JAL:
		w_const( next ); w_setr( 31 );
		break;
	default:
		jit_emit_condition( op );
		if( INS_OP( op ) == OP_REGIMM && ( INS_RT( op ) == RT_BLTZAL || INS_RT( op ) == RT_BGEZAL ) )
		{
			/* written whether taken or not */
			w_const( next ); w_setr( 31 );
		}
		break;
	}

	if( INS_OP( op ) == OP_SPECIAL )
	{
		/* always taken */
		jit_emit_slot( slot, &s, dload != 0 );
		if( dload )
		{
			jit_emit_pending( dload );
		}
		jit_emit_leave( index + 2, 0, 1, dload ? JIT_LEAVE_OUT : JIT_LEAVE_PLAIN );
	}
	else if( !jit_branch_is_conditional( op ) )
	{
		jit_emit_slot( slot, &s, dload != 0 );
		if( dload )
		{
			jit_emit_pending( dload );
			jit_emit_leave( index + 2, target, 0, JIT_LEAVE_OUT );
		}
		else
		{
			jit_emit_leave( index + 2, target, 0, index );
		}
	}
	else
	{
		jit_emit_slot( slot, &s, dload != 0 );
		w_get( WL_COND );
		w_open( W_IF );
		if( dload )
		{
			/* taken: the load stays pending */
			jit_emit_pending( dload );
			jit_emit_leave( index + 2, target, 0, JIT_LEAVE_OUT );
		}
		else
		{
			jit_emit_leave( index + 2, target, 0, index );
		}
		if( dload )
		{
			/* not taken: the load completes at once */
			w_byte( W_ELSE );
			w_get( WL_DLOAD ); w_setr( dload );
		}
		w_end();
	}
}

/* a plain instruction at 'index' */
static void jit_emit_one( UINT32 op, UINT32 index )
{
	struct jit_op o;
	jit_decode( op, &o );

	if( o.cop2 )
	{
		jit_check_cop2( index );
	}
	switch( o.kind )
	{
	case JIT_MEM:
		jit_emit_mem_address( op, &o, index, WL_HOST );
		jit_emit_mem_access( op, WL_HOST, 0 );
		break;
	case JIT_HELPER_MEM:
		jit_emit_mem_address( op, &o, index, WL_HOST );
		jit_emit_helper_op( op, &o, WL_HOST );
		break;
	case JIT_HELPER:
		jit_emit_helper_op( op, &o, WL_HOST );
		break;
	default:
		jit_emit_simple_at( op, index, 0 );
		break;
	}
}

/* polling loop test (as psxjit.c jit_is_idle_loop) */
static int jit_is_idle_loop( const UINT32 *ops, UINT32 t, UINT32 index )
{
	UINT32 written = 0, all = 0, i;
	struct jit_op o;

	if( t > index )
	{
		return 0;
	}
	for( i = t; i <= index + 1; i++ )
	{
		jit_decode( ops[ i ], &o );
		if( i != index && o.kind != JIT_SIMPLE && !( o.kind == JIT_MEM && !o.store ) )
		{
			return 0;
		}
		if( o.hilo || o.trap )
		{
			return 0;
		}
		all |= o.writes;
	}
	for( i = t; i <= index + 1; i++ )
	{
		jit_decode( ops[ i ], &o );
		if( o.reads & all & ~written & ~1 )
		{
			return 0;
		}
		written |= o.writes;
	}
	return 1;
}


/*************************************
 *  Module assembly
 *************************************/

static UINT8 w_module[ JIT_MAX_MODULE + 64 ];
static int w_mlen;

static void m_byte( UINT8 b )
{
	if( w_mlen < (int)sizeof( w_module ) )
	{
		w_module[ w_mlen++ ] = b;
	}
	else
	{
		w_overflow = 1;
	}
}
static void m_u32( UINT32 v )
{
	do
	{
		UINT8 b = v & 0x7f;
		v >>= 7;
		m_byte( v ? ( b | 0x80 ) : b );
	} while( v );
}
static void m_bytes( const UINT8 *p, int n )
{
	while( n-- > 0 )
	{
		m_byte( *p++ );
	}
}
static void m_section( UINT8 id, const UINT8 *p, int n )
{
	m_byte( id );
	m_u32( n );
	m_bytes( p, n );
}

/*
	The module: types, imports (memory "e" "m", table "e" "t"), one
	function exported as "f". 'nlocals32' i32 locals and one i64 local.
*/
static int jit_assemble( int nlocals32, UINT32 pc )
{
	static const UINT8 header[] = { 0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00 };
	static const UINT8 types[] = {
		3,
		0x60, 0, 1, 0x7f,			/* () -> i32 */
		0x60, 1, 0x7f, 0,			/* (i32) -> () */
		0x60, 2, 0x7f, 0x7f, 0		/* (i32, i32) -> () */
	};
	static const UINT8 imports[] = {
		2,
		1, 'e', 1, 'm', 0x02, 0x00, 0x00,			/* memory, min 0 pages, no maximum */
		1, 'e', 1, 't', 0x01, 0x70, 0x00, 0x00		/* table funcref, min 0, no maximum */
	};
	static const UINT8 functions[] = { 1, WT_BLOCK };
	static const UINT8 exports[] = { 1, 1, 'f', 0x00, 0x00 };
	UINT8 locals[ 16 ];
	int nl = 0, body_size;

	/* local declarations: n i32, 1 i64 */
	locals[ nl++ ] = 2;
	{
		UINT32 v = nlocals32;
		do { UINT8 b = v & 0x7f; v >>= 7; locals[ nl++ ] = v ? ( b | 0x80 ) : b; } while( v );
	}
	locals[ nl++ ] = 0x7f;
	locals[ nl++ ] = 1;
	locals[ nl++ ] = 0x7e;

	body_size = nl + w_len;
	w_mlen = 0;
	m_bytes( header, sizeof( header ) );
	m_section( 1, types, sizeof( types ) );
	m_section( 2, imports, sizeof( imports ) );
	m_section( 3, functions, sizeof( functions ) );
	m_section( 7, exports, sizeof( exports ) );
	/* code section: 1 function */
	{
		UINT8 tmp[ 5 ];
		int n = 0;
		UINT32 v = body_size;
		do { UINT8 b = v & 0x7f; v >>= 7; tmp[ n++ ] = v ? ( b | 0x80 ) : b; } while( v );
		m_byte( 10 );
		m_u32( 1 + n + body_size );
		m_byte( 1 );
		m_bytes( tmp, n );
		m_bytes( locals, nl );
		m_bytes( w_body, w_len );
	}
	/* name section: the function is called psx_<pc> in browser profiles */
	{
		static const char hex[] = "0123456789abcdef";
		UINT8 name[ 12 ];
		int k;
		memcpy( name, "psx_", 4 );
		for( k = 0; k < 8; k++ )
		{
			name[ 4 + k ] = hex[ ( pc >> ( 28 - k * 4 ) ) & 15 ];
		}
		/* custom section 0: "name", function names (1): 1 entry, function 0, 12 bytes */
		m_byte( 0 );
		m_u32( 1 + 4 + 1 + 1 + 1 + 1 + 1 + 12 );
		m_byte( 4 ); m_bytes( (const UINT8 *)"name", 4 );
		m_byte( 1 ); m_u32( 1 + 1 + 1 + 12 );
		m_byte( 1 ); m_byte( 0 ); m_byte( 12 ); m_bytes( name, 12 );
	}
	return !w_overflow && w_mlen <= JIT_MAX_MODULE;
}


/*************************************
 *  Block translation
 *************************************/

/*
	After a jump: the next block, if it is translated (the cache entry
	for WL_PC has its address and code) and the timeslice has room for
	all of it, runs at once in place of this one (a tail call); jit_run
	would have done the same. Its other checks hold here: no load is
	pending (those ways out do not chain), and the status register is
	not changed by translated code.
*/
static void jit_emit_chain( void )
{
	const UINT32 table = (UINT32)(size_t)jit_table;

	w_get( WL_CHAIN );
	w_open( W_IF );
	/* T = byte offset of jit_table[ jit_table_index( pc ) ] */
	w_get( WL_PC ); w_const( 2 ); w_byte( W_I32_SHR_U );
	w_get( WL_PC ); w_const( 20 ); w_byte( W_I32_SHR_U );
	w_byte( W_I32_XOR );
	w_const( JIT_TABLE_SIZE - 1 ); w_byte( W_I32_AND );
	w_const( sizeof( struct jit_block ) ); w_byte( W_I32_MUL );
	w_tee( WL_T );
	w_memop( W_I32_LOAD, 2, table + offsetof( struct jit_block, pc ) );
	w_get( WL_PC ); w_byte( W_I32_EQ );
	w_open( W_IF );
	w_get( WL_T );
	w_memop( W_I32_LOAD, 2, table + offsetof( struct jit_block, code ) );
	w_tee( WL_ADDR );
	w_open( W_IF );
	w_load_abs( ICOUNT_ADDR );
	w_get( WL_T );
	w_memop( W_I32_LOAD16_U, 1, table + offsetof( struct jit_block, len ) );
	w_byte( W_I32_GE_S );
	w_open( W_IF );
#ifdef PSXWASM_STATS
	W_STORE_ABS( (UINT32)(size_t)&jit_stat[ JS_CHAINED ], w_load_abs( (UINT32)(size_t)&jit_stat[ JS_CHAINED ] ); w_const( 1 ); w_byte( W_I32_ADD ) );
#endif
	w_get( WL_ADDR );
	w_byte( W_RETURN_CALL_INDIRECT );
	w_u32( WT_BLOCK );
	w_byte( 0 );	/* table 0 */
	w_end();
	w_end();
	w_end();
	w_end();
}

/* translates the block at pc with at most 'limit' instructions into the module; returns its length or 0 */
static UINT32 jit_build( UINT32 pc, const UINT32 *ops, UINT32 maxcount, UINT32 limit, int *module_ok )
{
	static UINT8 kind[ JIT_MAX_BLOCK ];		/* 0 one, 1 branch */
	static UINT8 loopskip[ JIT_MAX_BLOCK ];	/* instruction n is the head of a wait loop */
	UINT32 count = 0, i;
	int ends = 0, n, nlocals, seg;

	*module_ok = 0;
	if( maxcount > limit )
	{
		maxcount = limit;
	}
	memset( kind, 0, sizeof( kind ) );

	/* walk the straight path: conditional branches fall through, jumps end the block */
	while( count < maxcount && !ends )
	{
		struct jit_op o;
		jit_decode( ops[ count ], &o );
		if( o.kind == JIT_NONE )
		{
			break;
		}
		if( o.kind != JIT_BRANCH )
		{
			kind[ count++ ] = 0;
			continue;
		}
		if( count + 2 > maxcount || !jit_slot_ok( ops[ count ], ops[ count + 1 ] ) )
		{
			break;
		}
		kind[ count ] = 1;
		if( !jit_branch_is_conditional( ops[ count ] ) )
		{
			ends = 1;
		}
		count += 2;
	}
	if( count == 0 )
	{
		return 0;
	}

	/* jump targets (instruction starts, never a delay slot) and polling loops */
	memset( &ctx, 0, sizeof( ctx ) );
	ctx.pc = pc;
	ctx.count = count;
	ctx.target[ 0 ] = 1;
	for( i = 0; i < count; i++ )
	{
		if( kind[ i ] )
		{
			UINT32 op = ops[ i ];
			if( INS_OP( op ) != OP_SPECIAL )
			{
				int t = jit_target_index( jit_branch_target( op, pc + i * 4 ) );
				if( t >= 0 )
				{
					UINT32 k;
					int inslot = 0;
					for( k = 0; k < count; k++ )
					{
						if( kind[ k ] && (UINT32)t == k + 1 )
						{
							inslot = 1;
						}
					}
					if( !inslot )
					{
						ctx.target[ t ] = 1;
						ctx.dispatch = 1;
						if( jit_is_idle_loop( ops, (UINT32)t, i ) )
						{
							ctx.idle[ i ] = 1;
						}
					}
				}
			}
			i++;
		}
	}

	/* wait loop heads: block start or jump targets, not right after a load */
	memset( loopskip, 0, sizeof( loopskip ) );
	for( i = 0; i < count; i++ )
	{
		if( ctx.target[ i ] && loop_kind( pc + i * 4 ) != LOOP_NONE )
		{
			struct jit_op prev;
			if( i > 0 )
			{
				jit_decode( ops[ i - 1 ], &prev );
				if( prev.kind == JIT_MEM || prev.kind == JIT_HELPER_MEM )
				{
					continue;
				}
			}
			loopskip[ i ] = 1;
		}
	}

	/* dispatch numbers of the jump targets */
	ctx.nseg = 0;
	for( i = 0; i < count; i++ )
	{
		ctx.seg[ i ] = -1;
		if( ctx.target[ i ] )
		{
			ctx.seg[ i ] = ctx.nseg++;
		}
	}

	/* registers: in locals if the block uses them; HI/LO if any instruction does */
	for( i = 0; i < count; i++ )
	{
		struct jit_op o;
		UINT32 op = ops[ i ];
		jit_decode( op, &o );
		ctx.used |= o.reads | o.writes;
		ctx.written |= o.writes;
		if( o.hilo || ( INS_OP( op ) == OP_SPECIAL && ( INS_FUNCT( op ) == FUNCT_MFHI || INS_FUNCT( op ) == FUNCT_MFLO ) ) )
		{
			ctx.hilo = 1;
		}
	}
	ctx.used &= ~1;
	ctx.written &= ~1;
	nlocals = 0;
	for( n = 0; n < WL_COUNT; n++ )
	{
		w_local[ n ] = -1;
	}
	for( n = 1; n < 32; n++ )
	{
		if( ctx.used & JBIT( n ) )
		{
			w_local[ n ] = nlocals++;
		}
	}
	for( n = WL_HI; n < WL_COUNT32; n++ )
	{
		w_local[ n ] = nlocals++;
	}
	w_local[ WL_T64 ] = nlocals;	/* the i64 local comes after the i32 ones */

	/* the function */
	w_len = 0;
	w_overflow = 0;
	w_level = 0;
	ctx.acct = 0;
	for( n = 1; n < 32; n++ )
	{
		if( ctx.used & JBIT( n ) )
		{
			w_load_abs( R_ADDR( n ) );
			w_set( n );
		}
	}
	if( ctx.hilo )
	{
		w_load_abs( HI_ADDR ); w_set( WL_HI );
		w_load_abs( LO_ADDR ); w_set( WL_LO );
	}
	w_open( W_BLOCK );
	ctx.out_level = w_level;
	if( ctx.dispatch )
	{
		/* loop { block_K { ... block_0 { br_table } code_0 } code_1 ... } code_K } */
		w_open( W_LOOP );
		ctx.loop_level = w_level;
		for( seg = ctx.nseg - 1; seg >= 0; seg-- )
		{
			w_open( W_BLOCK );
		}
		w_get( WL_STATE );
		w_byte( W_BR_TABLE );
		w_u32( ctx.nseg );
		for( seg = 0; seg < ctx.nseg; seg++ )
		{
			w_u32( seg );
		}
		w_u32( 0 );
		w_end();	/* block_0: segment 0 starts here */
	}

	for( i = 0; i < count; i++ )
	{
		if( ctx.target[ i ] )
		{
			if( i > 0 )
			{
				/* falling into a jump target: take the cycles so far, then the segment starts */
				jit_emit_cycles_to( i );
				ctx.acct = i;
				if( ctx.dispatch )
				{
					w_end();
				}
			}
			/* the head of a wait loop (psxloop.c): skip the passes that fit, */
			/* then go on only if the rest of the block still fits */
			if( loopskip[ i ] )
			{
				w_flush( 0xffffffff, 1 );
				w_const( pc + i * 4 );
				w_call( WT_V1, FN( loop_skip_helper ) );
				w_reload( 0xffffffff, 1 );
				w_load_abs( ICOUNT_ADDR ); w_const( count - i ); w_byte( W_I32_LT_S );
				jit_emit_exit_if( i );
			}
		}
		if( kind[ i ] )
		{
			jit_emit_branch( ops[ i ], ops[ i + 1 ], i );
			i++;
		}
		else
		{
			jit_emit_one( ops[ i ], i );
		}
	}

	/* straight off the end */
	if( !ends )
	{
		jit_emit_leave( count, pc + count * 4, 0, JIT_LEAVE_PLAIN );
	}
	if( ctx.dispatch )
	{
		w_end();	/* loop */
	}
	w_end();	/* out */
	/* the way out: registers back to mipscpu, the next pc */
	w_flush( 0xffffffff, 1 );
	if( jit_tailcalls )
	{
		jit_emit_chain();
	}
	w_get( WL_PC );
	w_byte( W_END );	/* function */

	*module_ok = jit_assemble( nlocals, pc );
	return count;
}

static void jit_compile( struct jit_block *block, UINT32 pc )
{
	static UINT32 ops[ JIT_MAX_BLOCK + 1 ];
	struct psx_fastram *region;
	const UINT8 *host;
	UINT32 count, maxcount, limit, i;
	int index, module_ok;

	block->pc = pc;
	block->len = 0;
	block->valid = 1;
	block->code = NULL;
	block->ramop = 0;
	block->tried = 1;

	/* code must sit in one fast RAM region */
	region = find_fastram( pc, 4 );
	if( !region || ( pc & 3 ) )
	{
		return;
	}
	host = region->base + ( pc - region->start );
	block->op0 = *(const UINT32 *)(const void *)host;
	block->ramop = 1;
	maxcount = ( region->end - pc + 1 ) / 4;
	if( maxcount > JIT_MAX_BLOCK )
	{
		maxcount = JIT_MAX_BLOCK;
	}
	/* the hooked instruction runs in the interpreter: the block stops before it */
	if( pc_hook_pc != PC_HOOK_NONE && pc_hook_pc >= pc && ( pc_hook_pc - pc ) / 4 < maxcount )
	{
		maxcount = ( pc_hook_pc - pc ) / 4;
	}
	for( i = 0; i < maxcount; i++ )
	{
		ops[ i ] = *(const UINT32 *)( host + i * 4 );
	}

	/* a module too big for synchronous compilation is retried shorter */
	limit = JIT_MAX_BLOCK;
	for( ;; )
	{
		count = jit_build( pc, ops, maxcount, limit, &module_ok );
		if( count == 0 )
		{
			return;
		}
		if( module_ok )
		{
			break;
		}
		if( count <= 2 )
		{
			return;
		}
		limit = count / 2;
	}

	/* bounded number of blocks: start again once it is reached */
	if( jit_live >= JIT_MAX_LIVE )
	{
		jit_flush();
		block->pc = pc;
		block->valid = 1;
		block->ramop = 1;
		block->tried = 1;
	}
	index = psxwasm_install( w_module, w_mlen );
	psxwasm_note( index > 0 ? 0 : 3 );
	if( index <= 0 )
	{
		if( !jit_failed_logged )
		{
			jit_failed_logged = 1;
			log_cb( RETRO_LOG_WARN, LOGPRE "PSX recompiler: a block could not be compiled, the interpreter runs it\n" );
		}
		return;
	}
	block->code = (void *)(size_t)index;
	block->len = count;
	jit_live++;

	/* remember where translated code lives */
	if( !region->readonly )
	{
		for( i = 0; i < count; i++ )
		{
			jit_codemap[ jit_codemap_index( host + i * 4 ) ] = 1;
		}
		jit_code_present = 1;
	}
}

/* a block that could not be translated is retried once the code at its pc changes */
static INLINE int jit_untranslatable_changed( const struct jit_block *block )
{
	struct psx_fastram *region;

	if( block->len != 0 || !block->ramop )
	{
		return 0;
	}
	region = find_fastram( block->pc, 4 );
	return region && *(const UINT32 *)(const void *)( region->base + ( block->pc - region->start ) ) != block->op0;
}

/* the cache entry for pc, reset for counting when it held another address or the code changed */
static INLINE struct jit_block *jit_lookup( UINT32 pc )
{
	struct jit_block *block = &jit_table[ jit_table_index( pc ) ];

	if( !block->valid || block->pc != pc || jit_untranslatable_changed( block ) )
	{
		jit_drop_code( block );
		block->valid = 1;
		block->pc = pc;
		block->len = 0;
		block->ramop = 0;
		block->tried = 0;
		block->heat = 0;
	}
	return block;
}

#ifdef PSXJIT_VERIFY
/* debug: every block also runs through the interpreter from the same state (as psxjit.c) */
static void jit_verify_block( struct jit_block *block, int before )
{
	static mips_cpu_context ctx_save, ctx_jit;
	static UINT32 jit_new[ PSXJIT_VLOG ];
	static unsigned long blocks;
	int n, i, j, bad = 0;

	ctx_save = mipscpu;
	jit_vlog_count = 0;
	mipscpu.pc = ( (jit_func)block->code )();
	n = before - mips_ICount;
	ctx_jit = mipscpu;
	for( i = 0; i < jit_vlog_count; i++ )
	{
		memcpy( &jit_new[ i ], jit_vlog[ i ].p, jit_vlog[ i ].size );
	}
	for( i = jit_vlog_count - 1; i >= 0; i-- )
	{
		memcpy( jit_vlog[ i ].p, &jit_vlog[ i ].old, jit_vlog[ i ].size );
	}
	mipscpu = ctx_save;
	interp_vlog_count = 0;
	jit_verify_logging = 1;
	for( i = 0; i < n; i++ )
	{
		mipscpu.op = cpu_readop32( mipscpu.pc );
		mips_step();
	}
	jit_verify_logging = 0;
	mips_ICount = before - n;
	if( mipscpu.pc != ctx_jit.pc || mipscpu.hi != ctx_jit.hi || mipscpu.lo != ctx_jit.lo ||
		mipscpu.delayr != ctx_jit.delayr || ( mipscpu.delayr && mipscpu.delayv != ctx_jit.delayv ) ||
		memcmp( mipscpu.r, ctx_jit.r, sizeof( mipscpu.r ) ) || memcmp( mipscpu.cp2dr, ctx_jit.cp2dr, sizeof( mipscpu.cp2dr ) ) ||
		memcmp( mipscpu.cp2cr, ctx_jit.cp2cr, sizeof( mipscpu.cp2cr ) ) || mipscpu.cp0r[ CP0_SR ] != ctx_jit.cp0r[ CP0_SR ] )
	{
		bad = 1;
	}
	for( i = 0; i < jit_vlog_count; i++ )
	{
		if( memcmp( &jit_new[ i ], jit_vlog[ i ].p, jit_vlog[ i ].size ) )
		{
			bad |= 2;
		}
	}
	for( i = 0; i < interp_vlog_count; i++ )
	{
		int found = 0;
		for( j = 0; j < jit_vlog_count; j++ )
		{
			if( jit_vlog[ j ].p <= interp_vlog[ i ].p && interp_vlog[ i ].p + interp_vlog[ i ].size <= jit_vlog[ j ].p + jit_vlog[ j ].size )
			{
				found = 1;
			}
		}
		if( !found && memcmp( &interp_vlog[ i ].old, interp_vlog[ i ].p, interp_vlog[ i ].size ) )
		{
			bad |= 4;
		}
	}
	blocks++;
	if( ( blocks % 1000000 ) == 0 )
	{
		fprintf( stderr, "JITVERIFY %lu blocks checked, %u live, %u flushes\n", blocks, jit_live, jit_flushes );
	}
	if( jit_vlog_count >= PSXJIT_VLOG || interp_vlog_count >= PSXJIT_VLOG )
	{
		bad = 0;
	}
	if( bad )
	{
		fprintf( stderr, "JITVERIFY mismatch %d at block %08x (%u instr), ran %d, block #%lu\n", bad, ctx_save.pc, block->len, n, blocks );
		fprintf( stderr, "JITVERIFY pc i=%08x j=%08x hi %08x/%08x lo %08x/%08x delayr %u/%u delayv %08x/%08x\n",
			mipscpu.pc, ctx_jit.pc, mipscpu.hi, ctx_jit.hi, mipscpu.lo, ctx_jit.lo, mipscpu.delayr, ctx_jit.delayr, mipscpu.delayv, ctx_jit.delayv );
		for( i = 0; i < 32; i++ )
		{
			if( mipscpu.r[ i ] != ctx_jit.r[ i ] || ctx_save.r[ i ] != mipscpu.r[ i ] )
			{
				fprintf( stderr, "JITVERIFY r%-2d before %08x interp %08x jit %08x%s\n", i, ctx_save.r[ i ], mipscpu.r[ i ], ctx_jit.r[ i ], mipscpu.r[ i ] != ctx_jit.r[ i ] ? "  <<<" : "" );
			}
		}
		for( i = 0; i < 32; i++ )
		{
			if( mipscpu.cp2dr[ i ].d != ctx_jit.cp2dr[ i ].d ) fprintf( stderr, "JITVERIFY cp2dr%d interp %08x jit %08x\n", i, mipscpu.cp2dr[ i ].d, ctx_jit.cp2dr[ i ].d );
			if( mipscpu.cp2cr[ i ].d != ctx_jit.cp2cr[ i ].d ) fprintf( stderr, "JITVERIFY cp2cr%d interp %08x jit %08x\n", i, mipscpu.cp2cr[ i ].d, ctx_jit.cp2cr[ i ].d );
		}
		for( i = 0; i < (int)block->len; i++ )
		{
			fprintf( stderr, "JITVERIFY op %08x %08x\n", ctx_save.pc + i * 4, cpu_readop32( ctx_save.pc + i * 4 ) );
		}
		exit( 1 );
	}
}
#endif

/*
	Runs the block at pc if there is one and it fits in the timeslice:
	returns 1 when it ran at least one instruction (mipscpu.pc and
	mips_ICount updated). Called before every instruction the
	interpreter would run; blocks are only looked for where code is
	arrived at by a jump, after a block, or after an instruction a
	block could not run (jit_retry_pc), so a timeslice that ends in the
	middle of a block does not make that point a block of its own.
*/
static INLINE int jit_run( void )
{
	struct jit_block *block;
	UINT32 pc = mipscpu.pc;
	int before;

	JIT_STAT( JS_CALLS, 1 );
	if( pc == jit_prev_pc + 4 && pc != jit_retry_pc )
	{
		/* straight on from the instruction the interpreter just ran */
		jit_prev_pc = pc;
		JIT_STAT( JS_INTERP, 1 );
		return 0;
	}
	JIT_STAT( JS_BOUNDARY, 1 );
	jit_prev_pc = pc;
	jit_retry_pc = 0xffffffff;
	if( ( mipscpu.cp0r[ CP0_SR ] & ( SR_ISC | SR_KUC ) ) != 0 )
	{
		JIT_STAT( JS_INTERP, 1 );
		return 0;
	}
	if( mipscpu.delayr != 0 )
	{
		/* a load or jump is pending: the interpreter finishes it, a block may start after */
		jit_retry_pc = pc + 4;
		JIT_STAT( JS_INTERP, 1 );
		return 0;
	}
	block = jit_lookup( pc );
	if( !block->tried )
	{
		if( ++block->heat < JIT_HEAT_MIN || mips_ICount < JIT_MAX_BLOCK )
		{
			JIT_STAT( JS_COLD, 1 );
			JIT_STAT( JS_INTERP, 1 );
			return 0;
		}
		jit_compile( block, pc );
	}
	if( block->len == 0 )
	{
		/* the instruction here cannot be translated: a block may start after it */
		jit_retry_pc = pc + 4;
		JIT_STAT( JS_UNTRANS, 1 );
		JIT_STAT( JS_INTERP, 1 );
		return 0;
	}
	if( (int)block->len > mips_ICount )
	{
		/* the end of the timeslice: the interpreter runs on to it */
		JIT_STAT( JS_NOFIT, 1 );
		JIT_STAT( JS_INTERP, 1 );
		return 0;
	}
	before = mips_ICount;
#ifdef PSXJIT_VERIFY
	jit_verify_block( block, before );
#else
	mipscpu.pc = ( (jit_func)block->code )();
#endif
	if( mips_ICount == before )
	{
		/* left before its first instruction: the interpreter runs it, a block may start after */
		jit_retry_pc = pc + 4;
		JIT_STAT( JS_EXIT0, 1 );
		JIT_STAT( JS_INTERP, 1 );
		return 0;
	}
	JIT_STAT( JS_RAN, 1 );
	JIT_STAT( JS_JITINSTR, before - mips_ICount );
#ifdef PSXWASM_STATS
	if( ( jit_stat[ JS_RAN ] & 0xffff ) == 0 )
	{
		psxwasm_counters( jit_stat, JS_COUNT, jit_stat_ops, JSO_COUNT );
	}
#endif
	loop_pure_armed = 0;	/* the interpreter's loop tracking (psxloop.c) saw none of this */
	change_pc32ledw( mipscpu.pc );
	jit_retry_pc = mipscpu.pc;
	return 1;
}

static void jit_reset_flush( void )
{
	jit_flush();
}
