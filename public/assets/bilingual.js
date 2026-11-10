/* Public works only. Translation is requested only after the visitor clicks.
 * Speech uses PoetrySpeaker; the first speak always runs in a separate click.
 */
(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  const CACHE_KEY = 'sakihana-english-v1';
  const assetURL = typeof document === 'undefined' ? '' : new URL('english-translations.json', document.currentScript.src).href;

  function segments(text, limit = 480) {
    const out = []; let part = '', bytes = 0;
    for (const line of String(text).match(/[^\n]*\n|[^\n]+$/gu) || []) {
      const size = encoder.encode(line).length;
      if (part && bytes + size > limit) { out.push(part); part = ''; bytes = 0; }
      for (const point of line) {
        const n = encoder.encode(point).length;
        if (bytes + n > limit) { out.push(part); part = ''; bytes = 0; }
        part += point; bytes += n;
      }
    }
    if (part) out.push(part);
    return out;
  }
  function abortCheck(signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  function translationError(message, code = 'service') {
    return Object.assign(new Error(message), {code});
  }
  function createTranslator(options = {}) {
    const fetcher = options.fetch || root.fetch.bind(root);
    const storage = options.storage;
    const cache = new Map();
    try {
      const saved = JSON.parse(storage?.getItem(CACHE_KEY) || '[]');
      if (Array.isArray(saved)) saved.slice(-60).forEach(entry => {
        if (typeof entry?.source === 'string' && typeof entry?.text === 'string' && entry.text.trim()) cache.set(entry.source, entry);
      });
    } catch (_) {}
    return async function translate(source, {signal, onProgress = () => {}} = {}) {
      source = String(source).trim();
      if (!source) throw translationError('翻訳する本文がありません。', 'empty');
      abortCheck(signal);
      if (cache.has(source)) return cache.get(source);
      const presets = await (options.presets || []);
      abortCheck(signal);
      const preset = presets.find(p => p.source === source);
      if (preset?.text?.trim()) return {source, text:preset.text, kind:'reference'};
      const parts = segments(source), translated = [];
      for (let i = 0; i < parts.length; i++) {
        abortCheck(signal); onProgress(i + 1, parts.length);
        if (!parts[i].trim()) { translated.push(''); continue; }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, {once:true});
        const timer = setTimeout(cancel, options.timeout ?? 20000);
        try {
          const url = new URL('https://api.mymemory.translated.net/get');
          url.searchParams.set('q', parts[i]); url.searchParams.set('langpair', 'ja|en');
          const response = await fetcher(url.href, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
          if (response.status === 429) throw translationError('翻訳サービスの利用上限です。時間をおいてお試しください。', 'quota');
          if (!response.ok) throw translationError('翻訳サービスに接続できませんでした。もう一度お試しください。');
          const data = await response.json();
          abortCheck(signal);
          if (data.quotaFinished || Number(data.responseStatus) === 429 || /MYMEMORY WARNING|USED ALL AVAILABLE FREE|QUERY LENGTH LIMIT/i.test(data.responseDetails || '')) {
            throw translationError('翻訳サービスの利用上限です。時間をおいてお試しください。', 'quota');
          }
          const text = data.responseData?.translatedText;
          if (Number(data.responseStatus) !== 200 || typeof text !== 'string' || !text.trim() || /MYMEMORY WARNING|USED ALL AVAILABLE FREE|QUERY LENGTH LIMIT/i.test(text)) {
            throw translationError('英訳を取得できませんでした。もう一度お試しください。');
          }
          translated.push(text.trim());
        } catch (error) {
          abortCheck(signal);
          if (error.code === 'quota' || error.code === 'service') throw error;
          throw translationError('英訳を取得できませんでした。通信状態を確認して、もう一度お試しください。');
        } finally {
          clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        }
      }
      abortCheck(signal);
      const entry = {source, text:translated.join('\n'), kind:'machine'};
      cache.set(source, entry);
      while (cache.size > 60) cache.delete(cache.keys().next().value);
      try { storage?.setItem(CACHE_KEY, JSON.stringify([...cache.values()])); } catch (_) {}
      return entry;
    };
  }

  function mount({host, speaker, poems, initialId}) {
    if (!host || !poems.length) return null;
    let storage; try { storage = root.localStorage; } catch (_) {}
    const presets = root.fetch(assetURL, {credentials:'omit'}).then(r => r.ok ? r.json() : []).catch(() => []);
    const translate = createTranslator({storage, presets});
    const panel = document.createElement('section');
    panel.id = 'bilingual-reader'; panel.className = 'bilingual-reader';
    panel.setAttribute('aria-label', '日本語と英語の朗読');
    panel.innerHTML = `<p class="eyebrow">JAPANESE / ENGLISH</p><h3>日本語と英語で、聴く。</h3>
      <label class="bilingual-choice">読む作品<select data-bilingual-poem></select></label>
      <div class="bilingual-actions"><button data-bilingual-ja>▶ 日本語で聴く</button><button data-bilingual-translate>英訳を表示</button><button data-bilingual-cancel hidden>翻訳を中止</button></div>
      <p class="bilingual-status" data-bilingual-status role="status" aria-live="polite">作品を選び、「英訳を表示」を押してください。</p>
      <p class="bilingual-caution" data-bilingual-caution hidden></p>
      <div class="bilingual-texts"><details><summary>日本語の原文</summary><p lang="ja" data-bilingual-original></p></details>
      <details data-bilingual-result hidden><summary>English · <span data-bilingual-kind>英訳</span></summary><p lang="en" dir="ltr" data-bilingual-english></p></details></div>
      <div class="bilingual-actions"><button class="button" data-bilingual-en disabled lang="en">▶ 英語で聴く / Listen in English</button><label>英語の声<select data-bilingual-voice><option value="">端末の英語音声</option></select></label></div>
      <details class="speech-help"><summary>英訳・英語の音声について</summary><p>英訳は参考訳です。自動翻訳では、詩の含みや固有名詞が正確に伝わらない場合があります。日本語の原文もあわせてお読みください。</p><p>用意済みの参考訳がない作品は、「英訳を表示」を押すと、その本文を外部のMyMemory翻訳サービスへ送ります。サービスには1日あたりの利用上限があります。取得済みの訳はこのブラウザに最大60作品分保存し、同じ原文では再利用します。</p><p>英訳の表示後、「英語で聴く」を押してください。停止・一時停止・再開と読む速さは上の朗読操作を使えます。音声は端末の合成音声です。英語の声が出ない場合は、端末の音声設定で英語音声を追加して、ChromeやSafariで開いてください。</p></details>`;
    host.append(panel);
    const $ = selector => panel.querySelector(selector);
    const select = $('[data-bilingual-poem]'), ja = $('[data-bilingual-ja]'), en = $('[data-bilingual-en]');
    const prepare = $('[data-bilingual-translate]'), cancel = $('[data-bilingual-cancel]');
    const status = $('[data-bilingual-status]'), voice = $('[data-bilingual-voice]');
    const items = new Map(poems.map(p => [String(p.id), p]));
    for (const p of poems) select.add(new Option(`${p.page ? 'No.' + String(p.page).padStart(4, '0') + ' · ' : ''}${p.title || String(p.id)}`, String(p.id)));
    if (items.has(String(initialId))) select.value = String(initialId);
    let current, translated = null, controller = null, revision = 0;
    const sourceOf = p => String(p.ttsBody || p.body || p.text || '').trim();
    function abort() {
      revision++; controller?.abort(); controller = null;
      prepare.disabled = false; cancel.hidden = true; panel.removeAttribute('aria-busy');
    }
    function choose() {
      abort(); current = items.get(select.value); translated = null; en.disabled = true;
      $('[data-bilingual-original]').textContent = sourceOf(current);
      $('[data-bilingual-result]').hidden = true; $('[data-bilingual-english]').textContent = '';
      const caution = $('[data-bilingual-caution]'); caution.hidden = !current.needsClarification;
      caution.textContent = current.needsClarification ? 'この作品の日本語原文には確認が必要な表記があります。英訳にもその影響が出る場合があります。' : '';
      status.textContent = '「英訳を表示」を押すと、この作品の英訳を準備します。';
    }
    select.addEventListener('change', () => { speaker.stop(); choose(); });
    ja.disabled = !speaker.supported;
    ja.addEventListener('click', () => { abort(); speaker.start([current]); });
    cancel.addEventListener('click', () => { abort(); status.textContent = '翻訳を中止しました。'; });
    prepare.addEventListener('click', async () => {
      abort(); speaker.stop(); const run = revision; const selected = current;
      controller = new AbortController(); prepare.disabled = true; cancel.hidden = false; panel.setAttribute('aria-busy', 'true');
      status.textContent = '英訳を準備しています…';
      try {
        const result = await translate(sourceOf(selected), {signal:controller.signal, onProgress:(i, n) => {
          if (run === revision) status.textContent = `英訳を準備しています… ${i} / ${n}`;
        }});
        if (run !== revision) return;
        // Provider strings are text only, including HTML entities and markup.
        const decoder = document.createElement('textarea'); decoder.innerHTML = result.text;
        translated = {...result, text:decoder.value};
        $('[data-bilingual-english]').textContent = translated.text;
        $('[data-bilingual-kind]').textContent = result.kind === 'reference' ? '参考訳（AI翻訳）' : '自動翻訳（MyMemory）';
        $('[data-bilingual-result]').hidden = false; $('[data-bilingual-result]').open = true;
        en.disabled = !speaker.supported;
        status.textContent = speaker.supported ? '英訳を表示しました。「英語で聴く」を押してください。' : '英訳を表示しました。このブラウザでは音声を利用できません。';
      } catch (error) {
        if (run === revision) status.textContent = error.name === 'AbortError' ? '翻訳を中止しました。' : error.message;
      } finally {
        if (run === revision) { controller = null; prepare.disabled = false; cancel.hidden = true; panel.removeAttribute('aria-busy'); }
      }
    });
    en.addEventListener('click', () => {
      if (!translated) return;
      speaker.start([{...current, ttsBody:translated.text, lang:'en-US', voiceURI:voice.value}]);
    });
    let savedVoice = ''; try { savedVoice = storage?.getItem('sakihana-english-voice') || ''; } catch (_) {}
    function voices() {
      const selected = voice.value || savedVoice;
      voice.replaceChildren(new Option('端末の英語音声', ''));
      root.speechSynthesis?.getVoices().filter(v => /^en(?:-|_|$)/i.test(v.lang)).forEach(v => voice.add(new Option(v.name, v.voiceURI)));
      if ([...voice.options].some(o => o.value === selected)) voice.value = selected;
    }
    voices(); root.speechSynthesis?.addEventListener?.('voiceschanged', voices);
    voice.addEventListener('change', () => { savedVoice = voice.value; try { storage?.setItem('sakihana-english-voice', voice.value); } catch (_) {} });
    const previous = speaker.onChange;
    speaker.onChange = state => {
      previous(state);
      if (['speaking', 'paused'].includes(state.status)) {
        if (controller) { abort(); status.textContent = '翻訳を中止して、朗読を開始しました。'; }
        if (state.poem && String(state.poem.id) !== select.value && items.has(String(state.poem.id))) {
          select.value = String(state.poem.id); choose();
        }
      }
    };
    root.addEventListener('pagehide', abort);
    choose();
    return {select: id => { if (items.has(String(id))) { select.value = String(id); choose(); } }};
  }
  const api = {segments, createTranslator, mount};
  root.PoetryBilingual = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
