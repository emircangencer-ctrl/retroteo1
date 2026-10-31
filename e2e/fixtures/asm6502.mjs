// Tiny 6502 assembler for self-authored test cartridges: [op, operand] pairs and ':label' strings.
const OPS = {
  'LDA#': 0xa9, 'LDX#': 0xa2, 'LDY#': 0xa0, 'AND#': 0x29, 'ORA#': 0x09, 'EOR#': 0x49, 'CMP#': 0xc9,
  LDA: [0xa5, 0xad], LDX: [0xa6, 0xae], LDY: [0xa4, 0xac], STA: [0x85, 0x8d], STX: [0x86, 0x8e], STY: [0x84, 0x8c],
  INC: [0xe6, 0xee], DEC: [0xc6, 0xce], ROL: [0x26, 0x2e], EOR: [0x45, 0x4d], AND: [0x25, 0x2d], ORA: [0x05, 0x0d],
  BIT: [0x24, 0x2c], CMP: [0xc5, 0xcd], JMP: [null, 0x4c],
  BNE: 'rel:d0', BEQ: 'rel:f0', BPL: 'rel:10', BMI: 'rel:30', BCC: 'rel:90', BCS: 'rel:b0',
  SEI: 0x78, CLD: 0xd8, TXS: 0x9a, RTI: 0x40, LSR: 0x4a, ASL: 0x0a, DEX: 0xca, INX: 0xe8, DEY: 0x88, INY: 0xc8,
  PHA: 0x48, PLA: 0x68, TAX: 0xaa, TXA: 0x8a, TAY: 0xa8, TYA: 0x98, CLC: 0x18, SEC: 0x38, NOP: 0xea
};
export function assemble(program, origin = 0xc000) {
  const labels = {};
  const size = item => { if (typeof item === 'string') return 0; const [op, arg] = item; const o = OPS[op]; if (o === undefined) throw new Error(`op ${op}`); if (typeof o === 'number') return op.endsWith('#') ? 2 : 1; if (typeof o === 'string') return 2; return typeof arg === 'number' && arg < 0x100 && o[0] !== null ? 2 : 3; };
  let pc = origin;
  for (const item of program) { if (typeof item === 'string') labels[item.slice(1)] = pc; pc += size(item); }
  const out = []; pc = origin;
  for (const item of program) {
    if (typeof item === 'string') continue;
    const [op, raw] = item; const o = OPS[op]; const arg = typeof raw === 'string' ? labels[raw] : raw;
    if (typeof raw === 'string' && arg === undefined) throw new Error(`label ${raw}`);
    if (typeof o === 'number') { out.push(o); if (op.endsWith('#')) out.push(arg & 0xff); }
    else if (typeof o === 'string') { const off = arg - (pc + 2); if (off < -128 || off > 127) throw new Error(`branch ${op} ${raw} out of range`); out.push(parseInt(o.slice(4), 16), off & 0xff); }
    else if (size(item) === 2) out.push(o[0], arg);
    else out.push(o[1], arg & 0xff, arg >> 8);
    pc += size(item);
  }
  return { bytes: out, labels };
}
