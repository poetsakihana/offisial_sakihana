/* Browser-native speech only. No audio or poem text is sent to a service by this code.
 * Device/browser voice implementations and background playback support vary.
 */
(function (root) {
  'use strict';
  function chunks(text, limit = 120) {
    const result = [];
    for (const sentence of String(text || '').replace(/\r/g, '').match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu) || []) {
      const points = Array.from(sentence.trim());
      for (let i = 0; i < points.length; i += limit) {
        const part = points.slice(i, i + limit).join('').trim();
        if (part) result.push(part);
      }
    }
    return result;
  }
  class PoetrySpeaker {
    constructor(options = {}) {
      this.synth = options.synth === undefined ? root.speechSynthesis : options.synth;
      this.Utterance = options.Utterance === undefined ? root.SpeechSynthesisUtterance : options.Utterance;
      this.onChange = options.onChange || (() => {});
      this.supported = !!(this.synth && this.Utterance && typeof this.synth.speak === 'function' && typeof this.synth.cancel === 'function');
      this.queue = []; this.index = 0; this.chunkIndex = 0; this.parts = [];
      this.status = 'idle'; this.error = ''; this.rate = 0.9; this.voiceURI = '';
      this.token = 0; this.utterance = null;
    }
    get state() {
      return {status:this.status, index:this.index, total:this.queue.length, poem:this.queue[this.index] || null,
        chunkIndex:this.chunkIndex, chunkTotal:this.parts.length, error:this.error};
    }
    emit() { this.onChange(this.state); }
    invalidate() {
      this.token++;
      this.utterance = null;
      if (this.supported) { try { this.synth.cancel(); } catch (_) {} }
    }
    start(poems) {
      this.invalidate();
      this.queue = Array.from(poems || []).filter(p => p && typeof p.ttsBody === 'string' && p.ttsBody.trim());
      this.index = 0; this.chunkIndex = 0; this.parts = []; this.error = '';
      if (!this.supported) return this.fail('このブラウザは読み上げに対応していません。SafariやChromeなどの対応ブラウザでお試しください。');
      if (!this.queue.length) { this.status = 'idle'; this.emit(); return; }
      this.parts = chunks(this.queue[0].ttsBody);
      this.status = 'speaking';
      // Keep the first speak in the click/tap's synchronous user-activation stack.
      try { if (this.synth.paused) this.synth.resume(); } catch (_) {}
      this.speak();
    }
    speak() {
      if (this.status !== 'speaking') return;
      if (this.chunkIndex >= this.parts.length) {
        if (this.index + 1 >= this.queue.length) {
          this.status = 'complete'; this.utterance = null; this.emit(); return;
        }
        this.index++; this.chunkIndex = 0; this.parts = chunks(this.queue[this.index].ttsBody);
      }
      const token = this.token;
      try {
        const utterance = new this.Utterance(this.parts[this.chunkIndex]);
        const poem = this.queue[this.index];
        const language = /^en(?:-|_|$)/i.test(poem.lang || '') ? 'en-US' : 'ja-JP';
        const matchesLanguage = voice => String(voice.lang).split(/[-_]/)[0].toLowerCase() === language.slice(0, 2);
        this.utterance = utterance; utterance.lang = language; utterance.rate = this.rate;
        const voices = typeof this.synth.getVoices === 'function' ? this.synth.getVoices() : [];
        const selected = voices.find(v => v.voiceURI === (poem.voiceURI || this.voiceURI) && matchesLanguage(v)) || voices.find(matchesLanguage);
        if (selected) utterance.voice = selected;
        const current = () => token === this.token && this.utterance === utterance;
        utterance.onend = () => {
          if (!current()) return;
          this.utterance = null; this.chunkIndex++;
          if (this.status === 'speaking') this.speak(); else this.emit();
        };
        utterance.onerror = event => {
          if (!current()) return;
          // Some mobile engines cancel when paused. Retry this short chunk on resume.
          if (this.status === 'paused' && ['canceled','interrupted'].includes(event.error)) {
            this.utterance = null; return;
          }
          this.fail(event.error === 'not-allowed'
            ? '音声を開始できませんでした。画面の再生ボタンをもう一度押してください。'
            : `読み上げが中断されました。端末の${language === 'en-US' ? '英語' : '日本語'}音声と音量を確認し、再生ボタンからお試しください。`);
        };
        this.emit();
        if (token === this.token && this.status === 'speaking') this.synth.speak(utterance);
      } catch (_) { this.fail('音声を開始できませんでした。対応ブラウザと端末の音声設定をご確認ください。'); }
    }
    fail(message) { this.invalidate(); this.status = 'error'; this.error = message; this.emit(); }
    pause() {
      if (this.status !== 'speaking') return;
      this.status = 'paused';
      try { this.synth.pause(); } catch (_) { this.invalidate(); }
      this.emit();
    }
    resume() {
      if (this.status !== 'paused') return;
      this.status = 'speaking';
      // Engines that silently discard paused speech must restart this chunk, not stall.
      if (this.utterance && this.synth.speaking === false && this.synth.pending === false) this.invalidate();
      try { this.synth.resume(); } catch (_) { this.invalidate(); }
      if (!this.utterance) this.speak(); else this.emit();
    }
    stop() { this.invalidate(); this.status = 'idle'; this.error = ''; this.emit(); }
    move(index) {
      if (!this.queue.length || !this.supported) return;
      this.invalidate(); this.index = Math.max(0, Math.min(index, this.queue.length - 1));
      this.chunkIndex = 0; this.parts = chunks(this.queue[this.index].ttsBody); this.status = 'speaking'; this.error = '';
      try { if (this.synth.paused) this.synth.resume(); } catch (_) {}
      this.speak();
    }
    next() { if (this.index + 1 < this.queue.length) this.move(this.index + 1); else { this.invalidate(); this.status = 'complete'; this.emit(); } }
    previous() { this.move(this.index - 1); }
    setRate(rate) { if (Number.isFinite(Number(rate))) this.rate = Math.max(0.5, Math.min(1.5, Number(rate))); }
    setVoice(uri) { this.voiceURI = String(uri || ''); }
  }
  PoetrySpeaker.chunks = chunks;
  root.PoetrySpeaker = PoetrySpeaker;
  if (typeof module !== 'undefined' && module.exports) module.exports = PoetrySpeaker;
})(typeof globalThis !== 'undefined' ? globalThis : window);
