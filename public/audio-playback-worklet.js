/**
 * Reusable AudioWorklet for streaming PCM16 audio playback.
 * Place in public/ folder and load via audioContext.audioWorklet.addModule()
 */
class RingBuffer {
  constructor(initialCapacity) {
    this.capacity = initialCapacity;
    this.buffer = new Float32Array(initialCapacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableData = 0;
  }

  push(data) {
    const len = data.length;
    // Auto-grow if needed
    while (this.availableData + len > this.capacity) {
      this.grow();
    }
    for (let i = 0; i < len; i++) {
      this.buffer[this.writeIndex] = data[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.availableData++;
    }
  }

  grow() {
    const newCapacity = this.capacity * 2;
    const newBuffer = new Float32Array(newCapacity);
    // Copy existing data maintaining order
    for (let i = 0; i < this.availableData; i++) {
      const srcIndex = (this.readIndex + i) % this.capacity;
      newBuffer[i] = this.buffer[srcIndex];
    }
    this.buffer = newBuffer;
    this.readIndex = 0;
    this.writeIndex = this.availableData;
    this.capacity = newCapacity;
  }

  pull(outputBuffer) {
    const len = outputBuffer.length;
    const available = Math.min(len, this.availableData);
    for (let i = 0; i < available; i++) {
      outputBuffer[i] = this.buffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.capacity;
    }
    // Pad remaining with silence
    for (let i = available; i < len; i++) {
      outputBuffer[i] = 0;
    }
    this.availableData -= available;
    return available > 0;
  }

  available() {
    return this.availableData;
  }

  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableData = 0;
  }
}

class AudioPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringBuffer = new RingBuffer(24000 * 30); // 30s initial capacity
    this.isPlaying = false;
    this.streamComplete = false;
    this.sampleRate = 24000;
    this.playbackRate = 1.0;
    this.playhead = 0;
    this.timeline = new Float32Array(24000 * 240); // 4 minutes initial
    this.timelineLength = 0;
    this.useTimelinePlayback = false;
    this._stateTick = 0;

    this.port.onmessage = (event) => {
      const { type, samples } = event.data;
      if (type === "audio") {
        this.appendToTimeline(samples);
        this.ringBuffer.push(samples);
        this.useTimelinePlayback = true;
        this.isPlaying = true;
      } else if (type === "clear") {
        this.ringBuffer.clear();
        this.isPlaying = false;
        this.streamComplete = false;
        this.playhead = 0;
        this.timelineLength = 0;
        this.useTimelinePlayback = false;
      } else if (type === "streamComplete") {
        this.streamComplete = true;
        this.useTimelinePlayback = true;
      } else if (type === "stop") {
        this.isPlaying = false;
        this.streamComplete = false;
      } else if (type === "setSpeed") {
        const speed = Number(event.data.speed);
        if (Number.isFinite(speed) && speed > 0.5 && speed <= 2.0) {
          this.playbackRate = speed;
        }
      } else if (type === "seek") {
        const timeSeconds = Number(event.data.timeSeconds);
        if (Number.isFinite(timeSeconds) && this.streamComplete) {
          const targetSample = Math.max(
            0,
            Math.min(
              Math.floor(timeSeconds * this.sampleRate),
              Math.max(0, this.timelineLength - 1)
            )
          );
          this.playhead = targetSample;
          this.useTimelinePlayback = true;
          this.isPlaying = true;
        }
      } else if (type === "meta") {
        const sr = Number(event.data.sampleRate);
        if (Number.isFinite(sr) && sr > 0) {
          this.sampleRate = sr;
        }
      }
    };
  }

  ensureTimelineCapacity(requiredLength) {
    if (requiredLength <= this.timeline.length) return;
    let newLength = this.timeline.length;
    while (newLength < requiredLength) {
      newLength *= 2;
    }
    const next = new Float32Array(newLength);
    next.set(this.timeline.subarray(0, this.timelineLength), 0);
    this.timeline = next;
  }

  appendToTimeline(samples) {
    const required = this.timelineLength + samples.length;
    this.ensureTimelineCapacity(required);
    this.timeline.set(samples, this.timelineLength);
    this.timelineLength = required;
  }

  emitState() {
    this.port.postMessage({
      type: "state",
      currentTime: this.sampleRate > 0 ? this.playhead / this.sampleRate : 0,
      duration: this.sampleRate > 0 ? this.timelineLength / this.sampleRate : 0,
      buffered:
        this.sampleRate > 0
          ? Math.max(0, this.timelineLength - this.playhead) / this.sampleRate
          : 0,
      streamComplete: this.streamComplete,
      isPlaying: this.isPlaying,
      speed: this.playbackRate,
      canSeek: this.streamComplete,
    });
  }

  readTimelineSample(index) {
    const i0 = Math.floor(index);
    const i1 = Math.min(i0 + 1, this.timelineLength - 1);
    const frac = index - i0;
    const s0 = this.timeline[i0] || 0;
    const s1 = this.timeline[i1] || s0;
    return s0 + (s1 - s0) * frac;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    if (this.isPlaying) {
      if (this.useTimelinePlayback) {
        for (let i = 0; i < channel.length; i++) {
          if (this.playhead >= this.timelineLength) {
            channel[i] = 0;
            continue;
          }
          channel[i] = this.readTimelineSample(this.playhead);
          this.playhead += this.playbackRate;
        }
      } else {
        this.ringBuffer.pull(channel);
        this.playhead += channel.length;
      }

      if (this.streamComplete && this.playhead >= this.timelineLength) {
        this.isPlaying = false;
        this.port.postMessage({ type: "ended" });
      }
    } else {
      channel.fill(0);
    }

    this._stateTick++;
    if (this._stateTick % 15 === 0) {
      this.emitState();
    }
    return true;
  }
}

registerProcessor("audio-playback-processor", AudioPlaybackProcessor);

