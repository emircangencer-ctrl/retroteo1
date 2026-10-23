class RetroPlayAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 32768;
    this.ring = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.port.onmessage = event => {
      const data = event.data;
      if (!data || data.type !== 'samples' || !data.buffer) return;
      const samples = new Float32Array(data.buffer);
      for (let i = 0; i + 1 < samples.length; i += 2) {
        let next = (this.writeIndex + 2) % this.capacity;
        if (next === this.readIndex) this.readIndex = (this.readIndex + 2) % this.capacity;
        this.ring[this.writeIndex] = samples[i];
        this.ring[(this.writeIndex + 1) % this.capacity] = samples[i + 1];
        this.writeIndex = next;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const left = output[0];
    const right = output[1] || output[0];
    for (let i = 0; i < left.length; i++) {
      if (this.readIndex !== this.writeIndex) {
        left[i] = this.ring[this.readIndex];
        right[i] = this.ring[(this.readIndex + 1) % this.capacity];
        this.readIndex = (this.readIndex + 2) % this.capacity;
      } else {
        left[i] = 0;
        right[i] = 0;
      }
    }
    return true;
  }
}
registerProcessor('retroplay-audio-processor', RetroPlayAudioProcessor);
