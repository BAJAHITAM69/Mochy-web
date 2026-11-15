// docs/app/app.js
// Main Application Controller for Mochy Music Web
// Implements:
//  - Multi-source CORS-safe Audio Streaming (Audius Full Tracks + Apple Music/iTunes Catalog + Local Files)
//  - Web Audio API Pipeline with AudioWorklet DSP (10-Band Parametric EQ + AutoEq + Freeverb Reverb + BS2B/Brown-Duda Spatial + Loudness Limiter)
//  - Multi-provider Word-by-Word & Line Synced Lyrics (YouLyPlus + LRCLib + Japanese/Chinese/Korean Romanizer)
//  - Full Mochy UX: Home, Search/Moods, Library (All/Local/Cached/Imported/Liked), Audio Lab, Stats/Recap, Settings, and 5 Player Styles (Flagship, Lyrics, Poster, Turntable, iPod Classic)

(() => {
  const DATA = window.MOCHY_DATA;
  const DSP = window.MochyDSP;

  // ---- Persistent Application State (mirrors AudioLabStore.kt & PreferenceKeys.kt) ----
  const savedState = (() => {
    try {
      return JSON.parse(localStorage.getItem('mochy_web_state_v1') || '{}');
    } catch {
      return {};
    }
  })();

  const defaultNodes = DATA.eqFrequencies.map((f) => ({
    frequency: f,
    gain: 0.0,
    q: DATA.octaveQ,
    filterType: 'PK',
    enabled: true
  }));

  const state = {
    activeTab: 'home',            // 'home' | 'search' | 'library' | 'audiolab' | 'stats' | 'settings'
    audioLabSubpage: 'main',      // 'main' | 'equalizer' | 'effects' | 'quality'
    eqTab: 0,                     // 0 = Graph, 1 = 10-Band Sliders, 2 = AutoEq
    libraryFilter: 'All',         // 'All' | 'Liked' | 'Local' | 'Cached' | 'Imported'
    wideLayout: window.innerWidth >= 960,
    playerSheetOpen: false,
    playerStyle: savedState.playerStyle || 'FLAGSHIP', // 'FLAGSHIP' | 'LYRICS' | 'POSTER' | 'TURNTABLE' | 'IPOD'
    playerBottomMode: 'lyrics',   // 'lyrics' | 'queue' | 'dsp' | 'styles'
    romanizeLyrics: savedState.romanizeLyrics !== false,

    // Playback Queue & State
    queue: savedState.queue && savedState.queue.length ? savedState.queue : [...DATA.seedTracks],
    currentIndex: 0,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 223,
    volume: savedState.volume ?? 0.9,
    playbackSpeed: savedState.playbackSpeed ?? 1.0,
    repeatMode: 0, // 0=off, 1=all, 2=one
    shuffle: false,

    // Search State
    searchQuery: '',
    searchLoading: false,
    searchResults: [],

    // Lyrics State
    lyricsLoading: false,
    lyricsProvider: 'YouLyPlus · Apple TTML',
    lyricsLines: [], // [{ timeMs, durationMs, text, roman, words: [{ timeMs, text }] }]
    activeLyricIndex: -1,

    // Audio Lab DSP State (100% identical to AudioLabStore.kt)
    eq: savedState.eq || {
      enabled: true,
      presetId: 'flat',
      preamp: 0.0,
      autoPreamp: true,
      selectedNode: 0,
      nodes: defaultNodes,
      correctionEnabled: false,
      correction: null
    },
    reverb: savedState.reverb || {
      enabled: false,
      presetId: 'room',
      mix: 0.5,
      roomSize: 0.55,
      damping: 0.45,
      wet: 0.6,
      dry: 1.0,
      width: 1.0,
      preDelayMs: 12,
      lowCutHz: 180
    },
    spatial: savedState.spatial || {
      enabled: false,
      mode: 'Crossfeed', // 'Crossfeed' | 'Speakers'
      cutoffHz: 700,
      feedDb: 4.5,
      speakerAngle: 30,
      amount: 1.0,
      mono: false
    },
    loudness: savedState.loudness || {
      enabled: false,
      boostDb: 4.0,
      compression: 0.3
    },

    // Live meters
    audioLevel: 0,
    loudnessReductionDb: 0,

    // Listening stats
    listenMinutes: savedState.listenMinutes || 23,
    modal: null // null | 'import' | 'recap' | 'apple-connect'
  };

  function saveState() {
    try {
      localStorage.setItem('mochy_web_state_v1', JSON.stringify({
        playerStyle: state.playerStyle,
        romanizeLyrics: state.romanizeLyrics,
        volume: state.volume,
        playbackSpeed: state.playbackSpeed,
        eq: state.eq,
        reverb: state.reverb,
        spatial: state.spatial,
        loudness: state.loudness,
        listenMinutes: state.listenMinutes,
        queue: state.queue.filter(t => !t.isBlob)
      }));
    } catch {}
  }

  // ---- Web Audio Engine & AudioWorklet Integration --------------------------
  const audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  audioEl.preload = 'auto';

  let audioCtx = null;
  let mediaSourceNode = null;
  let workletNode = null;
  let analyserNode = null;
  let masterGainNode = null;
  let fallbackBiquads = [];
  let analyserBuffer = new Uint8Array(128);
  let audioGraphReady = false;

  async function initAudioGraph() {
    if (audioGraphReady) {
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      mediaSourceNode = audioCtx.createMediaElementSource(audioEl);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.78;
      analyserBuffer = new Uint8Array(analyserNode.frequencyBinCount);
      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = state.volume;

      try {
        await audioCtx.audioWorklet.addModule('audio-processor.js?v=20261115');
        workletNode = new AudioWorkletNode(audioCtx, 'mochy-audio-lab-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        workletNode.port.onmessage = (e) => {
          if (e.data && e.data.type === 'meter') {
            state.audioLevel = e.data.level || 0;
            state.loudnessReductionDb = e.data.reductionDb || 0;
          }
        };
        mediaSourceNode.connect(workletNode);
        workletNode.connect(analyserNode);
        analyserNode.connect(masterGainNode);
        masterGainNode.connect(audioCtx.destination);
      } catch (workletErr) {
        console.warn('AudioWorklet fallback to native BiquadFilter chain:', workletErr);
        setupFallbackFilterChain();
      }

      audioGraphReady = true;
      pushAllDspToEngine();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
    } catch (err) {
      console.error('Failed to initialize Web Audio graph:', err);
    }
  }

  function setupFallbackFilterChain() {
    fallbackBiquads = state.eq.nodes.map((n) => {
      const f = audioCtx.createBiquadFilter();
      f.type = n.filterType === 'LSC' ? 'lowshelf' : n.filterType === 'HSC' ? 'highshelf' : n.filterType === 'LPQ' ? 'lowpass' : n.filterType === 'HPQ' ? 'highpass' : 'peaking';
      f.frequency.value = n.frequency;
      f.Q.value = n.q;
      f.gain.value = state.eq.enabled && n.enabled ? n.gain : 0;
      return f;
    });
    let prev = mediaSourceNode;
    for (const bf of fallbackBiquads) {
      prev.connect(bf);
      prev = bf;
    }
    prev.connect(analyserNode);
    analyserNode.connect(masterGainNode);
    masterGainNode.connect(audioCtx.destination);
  }

  function buildEqDesign() {
    if (!state.eq.enabled) return null;
    const own = (state.eq.nodes || []).filter(n => n.enabled);
    const corr = (state.eq.correctionEnabled && state.eq.correction) ? state.eq.correction.filters : [];
    const bands = [...own, ...corr];
    const headroom = state.eq.autoPreamp
      ? DSP.autoHeadroom(bands)
      : (state.eq.correctionEnabled && state.eq.correction ? state.eq.correction.preamp : 0.0);
    const preamp = (state.eq.preamp || 0) + headroom;
    return { preamp, bands };
  }

  function pushAllDspToEngine() {
    if (masterGainNode && audioCtx) {
      masterGainNode.gain.setTargetAtTime(state.volume, audioCtx.currentTime, 0.015);
    }
    if (workletNode) {
      workletNode.port.postMessage({ type: 'eq', design: buildEqDesign() });
      workletNode.port.postMessage({ type: 'reverb', params: state.reverb });
      workletNode.port.postMessage({ type: 'spatial', params: state.spatial });
      workletNode.port.postMessage({ type: 'loudness', params: state.loudness });
    } else if (fallbackBiquads.length) {
      state.eq.nodes.forEach((n, i) => {
        const bf = fallbackBiquads[i];
        if (!bf) return;
        bf.frequency.value = n.frequency;
        bf.Q.value = n.q;
        bf.gain.value = state.eq.enabled && n.enabled ? n.gain : 0;
      });
    }
    saveState();
  }

  // ---- Stream Resolution (Audius Full Stream + Apple Music Preview Fallback) ----
  const streamCache = new Map();

  async function resolveStreamUrl(track) {
    if (track.streamUrl) return { url: track.streamUrl, source: track.source || 'Local File', codec: track.codec || 'Unknown' };
    if (streamCache.has(track.id)) return streamCache.get(track.id);

    // 1. If track has direct Audius ID, use full-length CORS-enabled stream
    if (track.audiusId) {
      const directUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(track.audiusId)}/stream`;
      const resolved = { url: directUrl, source: 'Audius · Full Stream', codec: track.codec || 'MP3 320' };
      streamCache.set(track.id, resolved);
      return resolved;
    }

    throw new Error('This track has no verified source. Search and select a catalog result or load a local file.');
  }

  // ---- Multi-Provider Lyrics Engine (YouLyPlus Word TTML + LRCLib + Romanizer) ----
  const lyricsCache = new Map();

  // Lightweight Romanizer for Japanese Kana, Korean Hangul, and Cyrillic
  function romanizeLine(text) {
    if (!text) return '';
    // Hangul syllable decomposition into Revised Romanization
    const initials = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
    const medials = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
    const finals = ['','k','k','ks','n','nj','nh','t','l','lg','lm','lb','ls','lt','lp','lh','m','p','bs','t','t','ng','t','t','k','t','p','t'];
    let hasNonLatin = false;
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xAC00 && code <= 0xD7A3) {
        hasNonLatin = true;
        const idx = code - 0xAC00;
        const ini = Math.floor(idx / 588);
        const med = Math.floor((idx % 588) / 28);
        const fin = idx % 28;
        out += initials[ini] + medials[med] + finals[fin];
      } else if (code >= 0x3040 && code <= 0x30FF) {
        hasNonLatin = true;
        out += kanaCharToRomaji(text[i]);
      } else {
        out += text[i];
      }
    }
    return hasNonLatin ? out : '';
  }

  const KANA_MAP = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o','か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so','た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no','は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo','や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro','わ':'wa','を':'o','ん':'n',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go','ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do','ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
    'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
    'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no','ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
    'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo','ヤ':'ya','ユ':'yu','ヨ':'yo',
    'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n','ー':'-'
  };
  function kanaCharToRomaji(ch) {
    return KANA_MAP[ch] || ch;
  }

  function parseLrcText(lrc) {
    const lines = [];
    const rawLines = (lrc || '').split(/\r?\n/);
    const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/;
    const wordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]*)/g;

    for (const raw of rawLines) {
      const m = timeRegex.exec(raw);
      if (!m) continue;
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const msStr = (m[3] || '0').padEnd(3, '0');
      const timeMs = min * 60000 + sec * 1000 + parseInt(msStr, 10);
      let rest = raw.replace(timeRegex, '').replace(/^\{[^}]+\}/, '').trim();
      if (!rest) continue;

      const words = [];
      let wm;
      while ((wm = wordRegex.exec(rest)) !== null) {
        const wMin = parseInt(wm[1], 10);
        const wSec = parseInt(wm[2], 10);
        const wMs = parseInt((wm[3] || '0').padEnd(3, '0'), 10);
        const wText = wm[4].trim();
        if (wText) {
          words.push({ timeMs: wMin * 60000 + wSec * 1000 + wMs, text: wText });
        }
      }
      const cleanText = rest.replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, '').trim();
      lines.push({
        timeMs,
        text: cleanText,
        roman: romanizeLine(cleanText),
        words: words.length > 0 ? words : buildSyntheticWordTimings(cleanText, timeMs, 3200)
      });
    }
    return lines.sort((a, b) => a.timeMs - b.timeMs);
  }

  function buildSyntheticWordTimings(text, startMs, durationMs) {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return [];
    const step = Math.max(180, Math.floor((durationMs * 0.85) / parts.length));
    return parts.map((w, idx) => ({
      timeMs: startMs + idx * step,
      text: w
    }));
  }

  async function fetchLyricsForTrack(track) {
    if (!track) return;
    if (lyricsCache.has(track.id)) {
      const cached = lyricsCache.get(track.id);
      state.lyricsLines = cached.lines;
      state.lyricsProvider = cached.provider;
      state.lyricsLoading = false;
      renderLyricsStage();
      return;
    }

    state.lyricsLoading = true;
    state.lyricsLines = [];
    renderLyricsStage();

    const primaryArtist = (track.artist || '').split(',')[0].trim();
    const cleanTitle = (track.title || '').replace(/\(.*?\)/g, '').trim();
    const durSec = Math.round(track.duration || 210);

    // 1. Query YouLyPlus (Word-by-Word Apple TTML syllabus, exactly like YouLyPlus.kt)
    try {
      const url = `https://lyricsplus.prjktla.my.id/v2/lyrics/get?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(primaryArtist)}&duration=${durSec}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.lyrics) && json.lyrics.length > 0) {
          const parsed = json.lyrics.map((item) => {
            const lineTime = item.time || 0;
            const lineDur = item.duration || 3000;
            const text = (item.text || '').trim();
            const syllabus = Array.isArray(item.syllabus) && item.syllabus.length > 0
              ? item.syllabus.map(s => ({ timeMs: s.time || lineTime, text: (s.text || '').trim() })).filter(s => s.text)
              : buildSyntheticWordTimings(text, lineTime, lineDur);
            return {
              timeMs: lineTime,
              durationMs: lineDur,
              text,
              roman: romanizeLine(text),
              words: syllabus
            };
          }).filter(l => l.text);

          if (parsed.length > 0) {
            const provider = `YouLyPlus · ${json.metadata?.source || 'Word Sync'}`;
            lyricsCache.set(track.id, { lines: parsed, provider });
            state.lyricsLines = parsed;
            state.lyricsProvider = provider;
            state.lyricsLoading = false;
            renderLyricsStage();
            return;
          }
        }
      }
    } catch {}

    // 2. Fallback to LRCLib (LRCLibProvider.kt)
    try {
      const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + primaryArtist)}`);
      if (res.ok) {
        const list = await res.json();
        const match = Array.isArray(list) && list.find(item => item.syncedLyrics || item.plainLyrics);
        if (match) {
          const lines = match.syncedLyrics
            ? parseLrcText(match.syncedLyrics)
            : (match.plainLyrics || '').split(/\r?\n/).filter(Boolean).map((line, i) => ({
                timeMs: i * 4000,
                text: line,
                roman: romanizeLine(line),
                words: buildSyntheticWordTimings(line, i * 4000, 3400)
              }));
          if (lines.length > 0) {
            const provider = match.syncedLyrics ? 'LRCLib · Synced LRC' : 'LRCLib · Plain';
            lyricsCache.set(track.id, { lines, provider });
            state.lyricsLines = lines;
            state.lyricsProvider = provider;
            state.lyricsLoading = false;
            renderLyricsStage();
            return;
          }
        }
      }
    } catch {}

    state.lyricsLoading = false;
    state.lyricsProvider = 'Instrumental / Unsynced';
    state.lyricsLines = [
      { timeMs: 0, text: `♪ ${track.title} — ${track.artist}`, roman: '', words: [{ timeMs: 0, text: `♪ ${track.title}` }] }
    ];
    renderLyricsStage();
  }

  // ---- Playback Controller --------------------------------------------------
  function currentTrack() {
    return state.queue[state.currentIndex] || state.queue[0];
  }

  let playbackRequest = 0;
  async function loadAndPlayTrack(index, autoPlay = true) {
    if (index < 0 || index >= state.queue.length) return;
    const request = ++playbackRequest;
    audioEl.pause();
    state.isPlaying = false;
    playbackNotice("Loading audio…");
    state.currentIndex = index;
    const track = currentTrack();
    state.currentTime = 0;
    state.duration = track.duration || 210;
    state.activeLyricIndex = -1;

    // Apply ambient colors
    const [amb1, amb2] = track.ambient || ['#35275e', '#141026'];
    document.documentElement.style.setProperty('--ambient-1', amb1);
    document.documentElement.style.setProperty('--ambient-2', amb2);

    if (workletNode) {
      workletNode.port.postMessage({ type: 'flush' });
    }

    updatePlayerMetaUI();
    fetchLyricsForTrack(track);

    try {
      state.isBuffering = true;
      updateTransportIcons();
      const resolved = await resolveStreamUrl(track);
      if (request !== playbackRequest) return;
      track.source = resolved.source;
      track.codec = resolved.codec;
      audioEl.src = resolved.url;
      audioEl.playbackRate = state.playbackSpeed;
      updatePlayerMetaUI();

      if (autoPlay) {
        await initAudioGraph();
        await audioEl.play();
        if (request !== playbackRequest) return;
        state.isPlaying = true;
        playbackNotice(track.id.startsWith("apple-") ? "iTunes preview — not the full song" : "Playing · " + track.source);
      }
    } catch (err) {
      if (request !== playbackRequest) return;
      playbackNotice('Unable to play: ' + err.message);
      console.warn('Playback resolve/play warning:', err);
      state.isPlaying = false;
    } finally {
      if (request !== playbackRequest) return;
      state.isBuffering = false;
      updateTransportIcons();
      renderMainView();
    }

    updateMediaSession(track);
  }

  async function togglePlay() {
    await initAudioGraph();
    if (!audioEl.src) {
      await loadAndPlayTrack(state.currentIndex, true);
      return;
    }
    if (audioEl.paused) {
      try {
        await audioEl.play();
        state.isPlaying = true;
      } catch (e) {
        await loadAndPlayTrack(state.currentIndex, true);
      }
    } else {
      audioEl.pause();
      state.isPlaying = false;
    }
    updateTransportIcons();
  }

  function skipNext() {
    if (state.shuffle && state.queue.length > 1) {
      const next = Math.floor(Math.random() * state.queue.length);
      loadAndPlayTrack(next, true);
      return;
    }
    const next = (state.currentIndex + 1) % state.queue.length;
    loadAndPlayTrack(next, true);
  }

  function skipPrev() {
    if (audioEl.currentTime > 3.5) {
      audioEl.currentTime = 0;
      return;
    }
    const prev = (state.currentIndex - 1 + state.queue.length) % state.queue.length;
    loadAndPlayTrack(prev, true);
  }

  audioEl.addEventListener('error', () => { state.isPlaying = false; state.isBuffering = false; playbackNotice('Audio unavailable. Try again or select another catalog result.'); updateTransportIcons(); });

  audioEl.addEventListener('timeupdate', () => {
    state.currentTime = audioEl.currentTime || 0;
    if (audioEl.duration && isFinite(audioEl.duration)) {
      state.duration = audioEl.duration;
    }
    updateProgressUI();
    syncActiveLyrics();
  });

  audioEl.addEventListener('ended', () => {
    state.listenMinutes += Math.max(1, Math.round((state.duration || 180) / 60));
    saveState();
    if (state.repeatMode === 2) {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    } else {
      skipNext();
    }
  });

  audioEl.addEventListener('play', () => {
    state.isPlaying = true;
    updateTransportIcons();
  });

  audioEl.addEventListener('pause', () => {
    state.isPlaying = false;
    updateTransportIcons();
  });

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'Mochy Music',
      artwork: track.artwork ? [{ src: track.artwork, sizes: '512x512', type: 'image/jpeg' }] : []
    });
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('previoustrack', skipPrev);
    navigator.mediaSession.setActionHandler('nexttrack', skipNext);
  }

  // ---- Live Catalog Search (Audius Full Tracks + Apple Music Catalog) -------
  let searchTimer = null;
  function triggerSearch(query) {
    state.searchQuery = query;
    clearTimeout(searchTimer);
    if (!query.trim()) {
      state.searchResults = [];
      state.searchLoading = false;
      renderMainView();
      return;
    }
    state.searchLoading = true;
    renderMainView();
    searchTimer = setTimeout(() => performOnlineSearch(query.trim()), 280);
  }

  let searchRequest = 0;
  async function performOnlineSearch(query) {
    const request = ++searchRequest;
    try {
      const [audiusRes, itunesRes] = await Promise.allSettled([
        fetch(`https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=8`).then(r => r.json()),
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=10`).then(r => r.json())
      ]);

      const combined = [];
      if (audiusRes.status === 'fulfilled' && Array.isArray(audiusRes.value?.data)) {
        for (const t of audiusRes.value.data) {
          combined.push({
            id: `audius-${t.id}`,
            title: t.title || 'Untitled',
            artist: t.user?.name || t.user?.handle || 'Unknown Artist',
            album: t.genre || 'Single',
            duration: t.duration || 180,
            codec: 'Full stream',
            source: 'Audius · Full Stream',
            genre: t.genre || 'Electronic',
            artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'] || DATA.seedTracks[0].artwork,
            audiusId: t.id,
            ambient: ['#2e3856', '#111522'],
            liked: false
          });
        }
      }

      if (itunesRes.status === 'fulfilled' && Array.isArray(itunesRes.value?.results)) {
        for (const r of itunesRes.value.results) {
          if (!r.previewUrl) continue;
          combined.push({
            id: `apple-${r.trackId}`,
            title: r.trackName || 'Untitled',
            artist: r.artistName || 'Unknown Artist',
            album: r.collectionName || 'Single',
            duration: Math.round((r.trackTimeMillis || 180000) / 1000),
            codec: 'Preview',
            source: 'iTunes · Preview',
            genre: r.primaryGenreName || 'Pop',
            artwork: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
            streamUrl: r.previewUrl,
            ambient: ['#3d2948', '#150e1a'],
            liked: false
          });
        }
      }

      if (request !== searchRequest || query !== state.searchQuery.trim()) return;
      const words = normalize(query).split(' ').filter(Boolean);
      const scored = combined.map(t => {
        const text = normalize(t.title + ' ' + t.artist);
        const coverage = words.filter(w => text.includes(w)).length / words.length;
        t.versionLabel = /\b(cover|tribute|karaoke|instrumental|remix|live|sped up|slowed)\b/i.test(t.title + ' ' + t.artist) ? 'Alternate version / cover' : (t.id.startsWith('apple-') ? 'Catalog recording · verify artist' : 'Upload · originality unverified');
        return {t, score: coverage - (t.versionLabel.startsWith('Alternate') && !/cover|remix|live|karaoke/i.test(query) ? .15 : 0), coverage};
      });
      state.searchResults = scored.filter(x => x.coverage >= .6).sort((a,b)=>b.score-a.score).map(x=>x.t);
    } catch (e) {
      console.warn('Search error:', e);
    } finally {
      if (request !== searchRequest || query !== state.searchQuery.trim()) return;
      state.searchLoading = false;
      if (state.activeTab === 'search') renderMainView();
    }
  }

  // ---- Formatting Helpers ---------------------------------------------------
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- UI Rendering Engine --------------------------------------------------
  const mainPane = document.getElementById('mainPane');
  const playerSheet = document.getElementById('playerSheet');
  const shellEl = document.getElementById('mochyShell');

  function applyShellMode() {
    shellEl.classList.toggle('wide-mode', state.wideLayout);
    shellEl.classList.toggle('phone-mode', !state.wideLayout);
  }

  function setTab(tab) {
    state.activeTab = tab;
    if (tab === 'audiolab') state.audioLabSubpage = 'main';
    document.querySelectorAll('.nav-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    renderMainView();
    mainPane.scrollTop = 0;
  }

  function renderMainView() {
    switch (state.activeTab) {
      case 'home':
        renderHomeScreen();
        break;
      case 'search':
        renderSearchScreen();
        break;
      case 'library':
        renderLibraryScreen();
        break;
      case 'audiolab':
        renderAudioLabScreen();
        break;
      case 'stats':
        renderStatsScreen();
        break;
      case 'settings':
        renderSettingsScreen();
        break;
    }
  }

  // 1. HOME SCREEN (Matches app-home.webp)
  function renderHomeScreen() {
    renderPersonalHome();
  }

  function renderSongRowHtml(t, idx, isPlaying) {
    const isFlac = (t.codec || '').toUpperCase().includes('FLAC');
    return `
      <div class="song-row press ${isPlaying ? 'playing' : ''}" data-action="play-index" data-index="${idx}">
        <div class="song-row-art">
          <img src="${escapeHtml(t.artwork)}" alt="${escapeHtml(t.title)}" loading="lazy">
        </div>
        <div class="song-row-info">
          <div class="song-row-title">
            <span>${escapeHtml(t.title)}</span>
            <span class="codec-pill ${isFlac ? 'flac' : ''}">${escapeHtml(t.codec || 'OPUS')}</span>
          </div>
          <div class="song-row-sub">${escapeHtml(t.artist)} · ${formatTime(t.duration || 200)}</div>
        </div>
        <div class="song-row-actions">
          <button class="row-icon-btn ${t.liked ? 'liked' : ''}" data-action="toggle-like" data-id="${escapeHtml(t.id)}" title="Like">
            ${t.liked ? '♥' : '♡'}
          </button>
        </div>
      </div>
    `;
  }

  // 2. SEARCH SCREEN (Matches app-search.webp)
  function renderSearchScreen() {
    mainPane.innerHTML = `
      <div class="screen-header">
        <h1 class="screen-title">Search</h1>
      </div>
      <div class="search-box-wrap">
        <div class="search-input-bar">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="searchInput" type="search" placeholder="Search for tracks, albums, lyrics..." value="${escapeHtml(state.searchQuery)}" autocomplete="off">
          ${state.searchQuery ? `<button class="row-icon-btn" data-action="clear-search">✕</button>` : ''}
        </div>
      </div>

      ${state.searchQuery ? `
        <section class="section-block">
          <div class="section-head">
            <h2>${state.searchLoading ? 'Searching catalog…' : `Results (${state.searchResults.length})`}</h2>
          </div>
          <div class="song-list">
            ${state.searchResults.map((t, i) => `
              <div class="song-row press" data-action="play-search-result" data-result-index="${i}">
                <div class="song-row-art"><img src="${escapeHtml(t.artwork)}" alt=""></div>
                <div class="song-row-info">
                  <div class="song-row-title">
                    <span>${escapeHtml(t.title)}</span>
                    <span class="codec-pill">${escapeHtml(t.codec)}</span>
                  </div>
                  <div class="song-row-sub">${escapeHtml(t.artist)} · ${escapeHtml(t.source)}<br>${escapeHtml(t.versionLabel)}</div>
                </div>
                <div class="song-row-actions">
                  <button class="row-icon-btn" title="Play">▶</button>
                </div>
              </div>
            `).join('') || (!state.searchLoading ? `<p style="padding:0 20px;color:var(--soft)">No tracks found. Try another artist or song title.</p>` : '')}
          </div>
        </section>
      ` : `
        <section class="section-block">
          <div class="section-head">
            <h2>Moods & moments</h2>
          </div>
          <div class="moods-grid">
            ${DATA.moods.map(m => `
              <div class="mood-card press" style="background:${m.bg}" data-action="pick-mood" data-query="${escapeHtml(m.query)}">
                <span>${escapeHtml(m.title)}</span>
                <div class="mood-thumbs">
                  <img src="${escapeHtml(m.art1)}" alt="">
                  <img src="${escapeHtml(m.art2)}" alt="">
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      `}
    `;

    const input = document.getElementById('searchInput');
    if (input) {
      input.addEventListener('input', (e) => triggerSearch(e.target.value));
      if (state.searchQuery) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  // 3. LIBRARY SCREEN (Matches app-library.webp)
  function renderLibraryScreen() {
    const cur = currentTrack();
    const filters = ['All', 'Liked', 'Local', 'Cached', 'Imported'];
    const filtered = state.queue.filter(t => {
      if (state.libraryFilter === 'Liked') return t.liked;
      if (state.libraryFilter === 'Local') return t.isBlob;
      if (state.libraryFilter === 'Imported') return t.imported;
      return true;
    });

    mainPane.innerHTML = `
      <div class="screen-header">
        <h1 class="screen-title">Library</h1>
      </div>
      <div class="search-box-wrap">
        <div class="search-input-bar">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input type="search" placeholder="Search your library" oninput="window.filterLibraryInline && window.filterLibraryInline(this.value)">
        </div>
      </div>

      <div class="chip-bar">
        ${filters.map(f => `
          <button class="filter-chip press ${state.libraryFilter === f ? 'active' : ''}" data-action="set-lib-filter" data-filter="${f}">${f}</button>
        `).join('')}
      </div>

      <div class="import-card">
        <div class="import-icons-row">
          <div class="service-badge press" style="background:linear-gradient(135deg,#fa243c,#fb5c74)" data-action="open-modal" data-modal="apple-connect" title="Apple Music">♫</div>
          <div class="service-badge press" style="background:#0a0a0c;border:1px solid #333" data-action="open-modal" data-modal="import" title="Tidal / Monochrome">❖</div>
          <div class="service-badge press" style="background:#ff0033" data-action="open-modal" data-modal="import" title="YouTube Music">▶</div>
          <div class="service-badge press" style="background:#1ed760;color:#000" data-action="open-modal" data-modal="import" title="Spotify">●</div>
          <div class="service-badge press" style="background:#2b2b30" data-action="upload-local" title="Local Audio Files">＋</div>
        </div>
        <h3>Import your music here!</h3>
        <p>Connect your Apple Music / CSV playlist or drop local FLAC, WAV, or MP3 files.</p>
      </div>

      <section class="section-block">
        <div class="section-head">
          <h2>${state.libraryFilter} Songs (${filtered.length})</h2>
          <button class="section-action press" data-action="upload-local">+ Add Local Files</button>
        </div>
        <div class="song-list" id="librarySongList">
          ${filtered.map((t) => {
            const realIdx = state.queue.findIndex(q => q.id === t.id);
            return renderSongRowHtml(t, realIdx, cur && cur.id === t.id);
          }).join('') || `<p style="padding:12px 20px;color:var(--soft);text-align:center">Nothing here yet. Import your music above to fill your library.</p>`}
        </div>
      </section>
    `;
  }

  // 4. AUDIO LAB SCREEN (100% Exact Port of AudioLabScreen.kt, EqualizerScreen.kt, ReverbCard.kt, AudioFxScreen.kt)
  function renderAudioLabScreen() {
    if (state.audioLabSubpage === 'equalizer') {
      renderEqualizerSubscreen();
      return;
    }
    if (state.audioLabSubpage === 'effects') {
      renderAudioEffectsSubscreen();
      return;
    }

    const activeEffectsCount = [state.reverb.enabled, state.spatial.enabled, state.loudness.enabled].filter(Boolean).length;
    const activePreset = DATA.eqPresets.find(p => p.id === state.eq.presetId);

    mainPane.innerHTML = `
      <div class="screen-header">
        <h1 class="screen-title">Audio<br>Lab</h1>
        <p class="screen-subtitle">1:1 RBJ Parametric Biquad DSP · Lookahead Peak Limiter · Freeverb · BS2B</p>
      </div>

      <div class="audiolab-stack">
        <!-- Equalizer Hero Card -->
        <div class="lab-hero-card press" data-action="audiolab-sub" data-sub="equalizer">
          <div class="lab-status-dot ${state.eq.enabled ? 'on' : ''}">
            <i></i> ${state.eq.enabled ? `ON · ${(activePreset ? activePreset.name : 'Custom').toUpperCase()}` : 'OFF'}
          </div>
          <h3>Equalizer</h3>
          <svg class="lab-bg-art" viewBox="0 0 160 140" fill="none" stroke="#fff" stroke-width="2.5">
            <rect x="20" y="16" width="120" height="108" rx="22" transform="rotate(-10 80 70)"/>
            <line x1="52" y1="36" x2="52" y2="106" transform="rotate(-10 80 70)"/>
            <circle cx="52" cy="78" r="10" fill="#1c1c1e" transform="rotate(-10 80 70)"/>
            <line x1="80" y1="36" x2="80" y2="106" transform="rotate(-10 80 70)"/>
            <circle cx="80" cy="62" r="10" fill="#1c1c1e" transform="rotate(-10 80 70)"/>
            <line x1="108" y1="36" x2="108" y2="106" transform="rotate(-10 80 70)"/>
            <circle cx="108" cy="54" r="10" fill="#1c1c1e" transform="rotate(-10 80 70)"/>
          </svg>
        </div>

        <!-- Audio Effect Hero Card -->
        <div class="lab-hero-card press" data-action="audiolab-sub" data-sub="effects">
          <div class="lab-status-dot ${activeEffectsCount > 0 ? 'on' : ''}">
            <i></i> ${activeEffectsCount > 0 ? `${activeEffectsCount} ACTIVE` : 'ALL OFF'}
          </div>
          <h3>Audio Effect</h3>
          <svg class="lab-bg-art" viewBox="0 0 180 120" fill="none" stroke="#fff" stroke-width="2.2">
            <text x="15" y="98" font-size="92" font-weight="900" font-style="italic" font-family="Inter, sans-serif">FX</text>
          </svg>
        </div>

        <!-- Audio Quality Card -->
        <div class="lab-card" style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h4 style="margin:0;font-size:17px;font-weight:800">Audio Quality</h4>
            <p style="margin:3px 0 0;font-size:11.5px;color:var(--soft);letter-spacing:0.05em;text-transform:uppercase">
              ${escapeHtml((currentTrack()?.source || 'AUDIUS').split('·')[0])} · ${escapeHtml(currentTrack()?.codec || 'FLAC')} · 48 kHz FLOAT64 DSP
            </p>
          </div>
          <svg width="86" height="36" viewBox="0 0 86 36" stroke="var(--soft)" stroke-width="2" stroke-linecap="round">
            <line x1="6" y1="10" x2="6" y2="26"/><line x1="11" y1="5" x2="11" y2="31"/><line x1="16" y1="12" x2="16" y2="24"/>
            <line x1="26" y1="8" x2="26" y2="28"/><line x1="31" y1="4" x2="31" y2="32"/><line x1="36" y1="11" x2="36" y2="25"/>
            <line x1="46" y1="13" x2="46" y2="23"/><line x1="51" y1="7" x2="51" y2="29"/><line x1="56" y1="10" x2="56" y2="26"/>
            <line x1="66" y1="12" x2="66" y2="24"/><line x1="71" y1="8" x2="71" y2="28"/><line x1="76" y1="15" x2="76" y2="21"/>
          </svg>
        </div>

        <!-- Quick Live Reverb & Parametric EQ Preview -->
        <div class="lab-card">
          <div class="lab-toggle-row" style="margin-bottom:10px">
            <div>
              <h4>Live Parametric Response</h4>
              <p>Tap Equalizer above to drag nodes, Q factor & filter types</p>
            </div>
            <button class="mochy-switch ${state.eq.enabled ? 'on' : ''}" data-action="toggle-eq"><span></span></button>
          </div>
          <div class="lab-stage" style="height:165px">
            <canvas id="eqGraphCanvas" style="width:100%;height:100%;display:block"></canvas>
          </div>
        </div>
      </div>
    `;

    bindEqCanvasInteractions();
  }

  // 4A. EQUALIZER SUBSCREEN (Graph / 10-Band / AutoEq)
  function renderEqualizerSubscreen() {
    const selIdx = Math.max(0, Math.min(state.eq.nodes.length - 1, state.eq.selectedNode || 0));
    const selNode = state.eq.nodes[selIdx] || state.eq.nodes[0];
    const headroomDb = DSP.autoHeadroom(state.eq.nodes).toFixed(1);

    mainPane.innerHTML = `
      <div class="screen-header" style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="icon-circle-btn press" data-action="audiolab-sub" data-sub="main">‹</button>
          <div>
            <h1 class="screen-title" style="font-size:26px">Equalizer</h1>
            <p class="screen-subtitle">Auto-headroom ${headroomDb} dB · 5ms Lookahead Limiter</p>
          </div>
        </div>
        <button class="mochy-switch ${state.eq.enabled ? 'on' : ''}" data-action="toggle-eq"><span></span></button>
      </div>

      <div style="padding:0 16px">
        <div class="segmented-tabs">
          <button class="${state.eqTab === 0 ? 'active' : ''}" data-action="set-eq-tab" data-tab="0">Graph</button>
          <button class="${state.eqTab === 1 ? 'active' : ''}" data-action="set-eq-tab" data-tab="1">Bands</button>
          <button class="${state.eqTab === 2 ? 'active' : ''}" data-action="set-eq-tab" data-tab="2">AutoEq</button>
        </div>

        <!-- Built-in 21 Presets Row -->
        <div class="chip-bar" style="padding:2px 0 12px">
          ${DATA.eqPresets.map(p => `
            <button class="filter-chip press ${state.eq.presetId === p.id ? 'active' : ''}" data-action="apply-eq-preset" data-preset="${p.id}">${escapeHtml(p.name)}</button>
          `).join('')}
        </div>

        ${state.eqTab === 0 ? `
          <!-- Interactive Parametric Graph Editor -->
          <div class="lab-card" style="margin-bottom:14px">
            <div class="lab-stage" style="height:230px;touch-action:none">
              <canvas id="eqGraphCanvas" style="width:100%;height:100%;display:block;cursor:grab"></canvas>
            </div>

            <!-- Node Selector Pills -->
            <div class="chip-bar" style="padding:12px 0 6px">
              ${state.eq.nodes.map((n, idx) => {
                const col = DATA.nodeColors[idx % DATA.nodeColors.length];
                return `
                  <button class="filter-chip press ${idx === selIdx ? 'active' : ''}"
                    style="${idx === selIdx ? `border-color:${col};color:${col}` : ''}"
                    data-action="select-eq-node" data-index="${idx}">
                    #${idx + 1} · ${n.frequency >= 1000 ? (n.frequency / 1000).toFixed(1) + 'k' : Math.round(n.frequency)}Hz
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Filter Type Selector (PK, LSC, HSC, LPQ, HPQ) -->
            <div class="chip-bar" style="padding:4px 0 10px">
              ${DATA.filterTypes.map(ft => `
                <button class="filter-chip press ${selNode.filterType === ft.id ? 'active' : ''}"
                  data-action="set-node-filter" data-type="${ft.id}">${ft.name}</button>
              `).join('')}
            </div>

            <!-- Selected Node Fine Controls -->
            <div class="lab-slider-row">
              <div class="lab-slider-head"><span>Frequency</span><span id="eqFreqVal">${Math.round(selNode.frequency)} Hz</span></div>
              <input class="mochy-range" type="range" min="${DSP.MIN_LOG}" max="${DSP.MAX_LOG}" step="0.005"
                value="${Math.log10(selNode.frequency)}" data-slider="node-freq">
            </div>
            <div class="lab-slider-row">
              <div class="lab-slider-head"><span>Gain</span><span id="eqGainVal">${(selNode.gain >= 0 ? '+' : '') + selNode.gain.toFixed(1)} dB</span></div>
              <input class="mochy-range" type="range" min="-12" max="12" step="0.1"
                value="${selNode.gain}" data-slider="node-gain">
            </div>
            <div class="lab-slider-row">
              <div class="lab-slider-head"><span>Quality (Q)</span><span id="eqQVal">${selNode.q.toFixed(2)}</span></div>
              <input class="mochy-range" type="range" min="0.1" max="12" step="0.05"
                value="${selNode.q}" data-slider="node-q">
            </div>
          </div>
        ` : state.eqTab === 1 ? `
          <!-- Classic 10-Band Sliders -->
          <div class="lab-card" style="margin-bottom:14px">
            <div class="lab-slider-row" style="border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:8px">
              <div class="lab-slider-head"><span>Preamp</span><span id="preampVal">${(state.eq.preamp >= 0 ? '+' : '') + state.eq.preamp.toFixed(1)} dB</span></div>
              <input class="mochy-range" type="range" min="-12" max="12" step="0.5" value="${state.eq.preamp}" data-slider="eq-preamp">
            </div>
            ${state.eq.nodes.map((n, idx) => `
              <div class="lab-slider-row">
                <div class="lab-slider-head">
                  <span style="color:${DATA.nodeColors[idx % DATA.nodeColors.length]}">${n.frequency >= 1000 ? (n.frequency / 1000) + ' kHz' : n.frequency + ' Hz'}</span>
                  <span id="bandGainVal-${idx}">${(n.gain >= 0 ? '+' : '') + n.gain.toFixed(1)} dB</span>
                </div>
                <input class="mochy-range" type="range" min="-12" max="12" step="0.2" value="${n.gain}" data-slider="band-gain" data-index="${idx}">
              </div>
            `).join('')}
          </div>
        ` : `
          <!-- AutoEq Headphone Profiles Tab -->
          <div class="lab-card" style="margin-bottom:14px">
            <div class="lab-toggle-row" style="margin-bottom:12px">
              <div>
                <h4>AutoEq Headphone Correction</h4>
                <p>${state.eq.correction ? `${state.eq.correction.name} (${state.eq.correction.source})` : 'Pick your headphone model below'}</p>
              </div>
              <button class="mochy-switch ${state.eq.correctionEnabled ? 'on' : ''}" data-action="toggle-autoeq"><span></span></button>
            </div>
            <div class="song-list" style="padding:0">
              ${DATA.autoEqCatalog.map((hp, idx) => {
                const isSelected = state.eq.correction && state.eq.correction.name === hp.name;
                return `
                  <div class="song-row press ${isSelected ? 'playing' : ''}" data-action="pick-autoeq" data-index="${idx}">
                    <div class="song-row-info">
                      <div class="song-row-title">
                        <span>${escapeHtml(hp.name)}</span>
                        <span class="codec-pill">${escapeHtml(hp.form)}</span>
                      </div>
                      <div class="song-row-sub">${escapeHtml(hp.source)} · Preamp ${hp.preamp} dB · ${hp.filters.length} Biquad bands</div>
                    </div>
                    <div class="song-row-actions">
                      <span style="font-size:12px;font-weight:800;color:${isSelected ? 'var(--accent)' : 'var(--soft)'}">${isSelected ? 'ACTIVE' : 'Apply'}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `}
      </div>
    `;

    bindEqCanvasInteractions();
    bindEqSliders();
  }

  // 4B. AUDIO EFFECTS SUBSCREEN (ReverbCard.kt + Spatial + Loudness + Speed)
  function renderAudioEffectsSubscreen() {
    mainPane.innerHTML = `
      <div class="screen-header" style="display:flex;align-items:center;gap:12px">
        <button class="icon-circle-btn press" data-action="audiolab-sub" data-sub="main">‹</button>
        <div>
          <h1 class="screen-title" style="font-size:26px">Audio Effects</h1>
          <p class="screen-subtitle">Jezar Freeverb · BS2B & Brown-Duda Spatial · Soft-Knee Limiter</p>
        </div>
      </div>

      <div class="audiolab-stack">
        <!-- REVERB CARD (100% identical to ReverbCard.kt) -->
        <div class="lab-card">
          <div class="lab-stage" style="height:126px;margin-bottom:12px">
            <canvas id="reverbCanvas" style="width:100%;height:100%;display:block"></canvas>
          </div>
          <div class="lab-toggle-row">
            <div>
              <h4>Reverb</h4>
              <p>Eight damped combs into four allpasses per side</p>
            </div>
            <button class="mochy-switch ${state.reverb.enabled ? 'on' : ''}" data-action="toggle-reverb"><span></span></button>
          </div>

          <div class="chip-bar" style="padding:12px 0 6px">
            ${DATA.reverbPresets.map(p => `
              <button class="filter-chip press ${state.reverb.presetId === p.id ? 'active' : ''}" data-action="apply-reverb-preset" data-preset="${p.id}">${p.name}</button>
            `).join('')}
          </div>

          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Mix</span><span id="revMixVal">${Math.round(state.reverb.mix * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.01" value="${state.reverb.mix}" data-reverb="mix">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Room size</span><span id="revRoomVal">${Math.round(state.reverb.roomSize * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.01" value="${state.reverb.roomSize}" data-reverb="roomSize">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Damping</span><span id="revDampVal">${Math.round(state.reverb.damping * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.01" value="${state.reverb.damping}" data-reverb="damping">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Wet</span><span id="revWetVal">${Math.round(state.reverb.wet * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.01" value="${state.reverb.wet}" data-reverb="wet">
          </div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--soft);margin:8px 0 4px">FINE TUNE</div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Dry</span><span id="revDryVal">${Math.round(state.reverb.dry * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.01" value="${state.reverb.dry}" data-reverb="dry">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Width</span><span id="revWidthVal">${Math.round(state.reverb.width * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.01" value="${state.reverb.width}" data-reverb="width">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Pre-delay</span><span id="revPredelayVal">${Math.round(state.reverb.preDelayMs)} ms</span></div>
            <input class="mochy-range" type="range" min="0" max="120" step="1" value="${state.reverb.preDelayMs}" data-reverb="preDelayMs">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Low cut</span><span id="revLowcutVal">${Math.round(state.reverb.lowCutHz)} Hz</span></div>
            <input class="mochy-range" type="range" min="20" max="1000" step="5" value="${state.reverb.lowCutHz}" data-reverb="lowCutHz">
          </div>
        </div>

        <!-- SPATIAL AUDIO CARD (SpatialAudioProcessor.kt) -->
        <div class="lab-card">
          <div class="lab-toggle-row" style="margin-bottom:10px">
            <div>
              <h4>Spatial Audio</h4>
              <p>BS2B Crossfeed & Brown-Duda Spherical Head Virtual Speakers</p>
            </div>
            <button class="mochy-switch ${state.spatial.enabled ? 'on' : ''}" data-action="toggle-spatial"><span></span></button>
          </div>

          <div class="chip-bar" style="padding:4px 0 10px">
            <button class="filter-chip press ${state.spatial.mode === 'Crossfeed' ? 'active' : ''}" data-action="set-spatial-mode" data-mode="Crossfeed">Crossfeed (BS2B)</button>
            <button class="filter-chip press ${state.spatial.mode === 'Speakers' ? 'active' : ''}" data-action="set-spatial-mode" data-mode="Speakers">Virtual Speakers</button>
            <button class="filter-chip press ${state.spatial.mono ? 'active' : ''}" data-action="toggle-mono">Mono Fold</button>
          </div>

          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Amount</span><span id="spatAmtVal">${Math.round(state.spatial.amount * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.02" value="${state.spatial.amount}" data-spatial="amount">
          </div>
          ${state.spatial.mode === 'Speakers' ? `
            <div class="lab-slider-row">
              <div class="lab-slider-head"><span>Speaker Angle</span><span id="spatAngleVal">±${Math.round(state.spatial.speakerAngle)}°</span></div>
              <input class="mochy-range" type="range" min="10" max="75" step="1" value="${state.spatial.speakerAngle}" data-spatial="speakerAngle">
            </div>
          ` : `
            <div class="lab-slider-row">
              <div class="lab-slider-head"><span>Head Shadow Cutoff</span><span id="spatCutoffVal">${Math.round(state.spatial.cutoffHz)} Hz</span></div>
              <input class="mochy-range" type="range" min="300" max="2000" step="10" value="${state.spatial.cutoffHz}" data-spatial="cutoffHz">
            </div>
            <div class="lab-slider-row">
              <div class="lab-slider-head"><span>Crossfeed Level</span><span id="spatFeedVal">${state.spatial.feedDb.toFixed(1)} dB</span></div>
              <input class="mochy-range" type="range" min="1" max="15" step="0.5" value="${state.spatial.feedDb}" data-spatial="feedDb">
            </div>
          `}
        </div>

        <!-- LOUDNESS & LIMITER CARD (LoudnessAudioProcessor.kt) -->
        <div class="lab-card">
          <div class="lab-toggle-row" style="margin-bottom:10px">
            <div>
              <h4>Loudness & Peak Limiter</h4>
              <p>Stereo-linked compressor + boost under -0.5 dBFS soft knee</p>
            </div>
            <button class="mochy-switch ${state.loudness.enabled ? 'on' : ''}" data-action="toggle-loudness"><span></span></button>
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Gain Boost</span><span id="loudBoostVal">+${state.loudness.boostDb.toFixed(1)} dB</span></div>
            <input class="mochy-range" type="range" min="0" max="12" step="0.5" value="${state.loudness.boostDb}" data-loudness="boostDb">
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Quiet-Parts Compression</span><span id="loudCompVal">${Math.round(state.loudness.compression * 100)}%</span></div>
            <input class="mochy-range" type="range" min="0" max="1" step="0.05" value="${state.loudness.compression}" data-loudness="compression">
          </div>
        </div>
      </div>
    `;

    bindFxSliders();
  }

  // 5. STATS & RE'CAP SCREEN (Matches app-stats.webp & app-recap.webp)
  function renderStatsScreen() {
    const hrs = Math.floor(state.listenMinutes / 60);
    const mins = state.listenMinutes % 60;
    mainPane.innerHTML = `
      <div class="screen-header">
        <div style="display:flex;align-items:baseline;gap:10px">
          <h1 class="screen-title">Stats</h1>
          <span class="press" style="font-size:20px;font-weight:800;color:var(--soft)" data-action="open-modal" data-modal="recap">2026 Re'cap ›</span>
        </div>
        <div style="font-size:24px;font-weight:800;margin-top:8px">November <span style="color:var(--faint);font-size:17px;margin-left:16px">December</span></div>
      </div>

      <!-- Tick timeline bar from app-stats.webp -->
      <div style="padding:4px 20px 16px;display:flex;align-items:center;gap:3px;overflow:hidden">
        ${Array.from({ length: 46 }, (_, i) => `
          <div style="width:2px;height:${i === 10 ? 34 : 18}px;background:${i === 10 ? '#fff' : 'rgba(255,255,255,0.22)'};flex-shrink:0"></div>
        `).join('')}
      </div>

      <div class="stats-card">
        <div style="font-size:13.5px;font-weight:700;color:rgba(255,255,255,0.85)">This month, you've been listening for</div>
        <div class="stats-big-time">${hrs}<small>h</small>:${mins < 10 ? '0' + mins : mins}<small>m</small></div>
        <div style="border-top:1px solid var(--line);padding-top:12px;display:flex;gap:14px;font-size:12.5px;color:var(--soft);font-weight:700">
          <span>■ ${state.queue.length} Songs</span>
          <span>■ ${new Set(state.queue.map(t => t.artist)).size} Artists</span>
          <span>■ ${new Set(state.queue.map(t => t.album)).size} Albums</span>
        </div>
      </div>

      <div class="stats-card">
        <div style="font-size:13.5px;font-weight:700;color:var(--soft)">Dominant Genre</div>
        <div style="font-size:26px;font-weight:800;margin:2px 0 14px">Pop & Electronic</div>
        <div style="display:flex;align-items:center;gap:28px">
          <svg width="116" height="116" viewBox="0 0 42 42">
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#26262a" stroke-width="5"/>
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#3b82f6" stroke-width="5" stroke-dasharray="51 49" stroke-dashoffset="25"/>
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#e06c3a" stroke-width="5" stroke-dasharray="34 66" stroke-dashoffset="-26"/>
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#10b981" stroke-width="5" stroke-dasharray="15 85" stroke-dashoffset="-60"/>
          </svg>
          <div>
            <div style="font-size:28px;font-weight:800">51%</div>
            <div style="font-size:13px;color:var(--soft)">Pop / Electronic</div>
          </div>
        </div>
      </div>
    `;
  }

  // 6. SETTINGS SCREEN (Matches app-settings.webp)
  function renderSettingsScreen() {
    mainPane.innerHTML = `
      <div class="screen-header">
        <h1 class="screen-title">Settings</h1>
      </div>

      <div class="stats-card press" data-action="go-audiolab" style="margin-bottom:18px">
        <div style="font-size:12px;color:var(--soft);margin-bottom:10px">Recommended item</div>
        <div style="display:flex;align-items:center;gap:14px">
          <div class="icon-circle-btn" style="width:46px;height:46px;background:#2a2a30">ılı</div>
          <div>
            <div style="font-size:15.5px;font-weight:800">Configure Equalizer settings</div>
            <div style="font-size:12.5px;color:var(--soft)">Settings › Audio Lab</div>
          </div>
        </div>
      </div>

      <div class="audiolab-stack">
        <div class="lab-card press" data-action="go-audiolab" style="display:flex;align-items:center;gap:14px">
          <div class="icon-circle-btn">ılı</div>
          <div>
            <h4 style="margin:0;font-size:16px">Audio Lab</h4>
            <p style="margin:2px 0 0;font-size:12px;color:var(--soft)">Parametric EQ, AutoEq, Freeverb, Spatial Audio</p>
          </div>
        </div>

        <div class="lab-card" style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h4 style="margin:0;font-size:16px">Player Style</h4>
            <p style="margin:2px 0 0;font-size:12px;color:var(--soft)">Flagship, Lyrics, Poster, Turntable, or iPod Classic</p>
          </div>
          <select id="styleSelect" style="background:var(--chip);color:#fff;border:1px solid var(--line);padding:8px 12px;border-radius:12px;font-weight:700">
            ${['FLAGSHIP', 'LYRICS', 'POSTER', 'TURNTABLE', 'IPOD'].map(s => `
              <option value="${s}" ${state.playerStyle === s ? 'selected' : ''}>${s}</option>
            `).join('')}
          </select>
        </div>

        <div class="lab-card" style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h4 style="margin:0;font-size:16px">Lyrics Romanization</h4>
            <p style="margin:2px 0 0;font-size:12px;color:var(--soft)">Auto-transliterate Japanese, Korean & Cyrillic lyrics</p>
          </div>
          <button class="mochy-switch ${state.romanizeLyrics ? 'on' : ''}" data-action="toggle-romanize"><span></span></button>
        </div>

        <div class="lab-card" style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h4 style="margin:0;font-size:16px">Desktop Side-by-Side Studio Layout</h4>
            <p style="margin:2px 0 0;font-size:12px;color:var(--soft)">Dock the Flagship Player beside the main view on wide screens</p>
          </div>
          <button class="mochy-switch ${state.wideLayout ? 'on' : ''}" data-action="toggle-layout"><span></span></button>
        </div>
      </div>
    `;

    const sel = document.getElementById('styleSelect');
    if (sel) {
      sel.addEventListener('change', (e) => {
        state.playerStyle = e.target.value;
        saveState();
        renderPlayerSheet();
      });
    }
  }

  // ---- Flagship Player Sheet & Alternate Player Styles ----------------------
  function renderPlayerSheet() {
    const cur = currentTrack() || DATA.seedTracks[0];
    const isPlaying = state.isPlaying;

    if (state.playerStyle === 'IPOD') {
      playerSheet.innerHTML = `
        <div class="player-handle-row">
          <button class="icon-circle-btn press" data-action="close-player">⌄</button>
          <span style="font-size:12px;font-weight:800;color:var(--soft)">iPod Classic Style</span>
          <button class="icon-circle-btn press" data-action="cycle-style">✦</button>
        </div>
        <div class="ipod-shell">
          <div class="ipod-screen">
            <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:800;border-bottom:1px solid rgba(0,0,0,0.12);padding-bottom:4px">
              <span>Now Playing</span>
              <span>${state.currentIndex + 1} of ${state.queue.length}</span>
            </div>
            <div style="display:flex;gap:12px;align-items:center;margin:10px 0">
              <img src="${escapeHtml(cur.artwork)}" alt="" style="width:76px;height:76px;border-radius:6px;object-fit:cover;box-shadow:0 4px 10px rgba(0,0,0,0.25)">
              <div style="min-width:0;flex:1">
                <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(cur.title)}</div>
                <div style="font-weight:600;font-size:12px;color:#4a4d57;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(cur.artist)}</div>
                <div style="font-weight:600;font-size:11px;color:#6c707d;margin-top:2px">${escapeHtml(cur.album || '')}</div>
              </div>
            </div>
            <div>
              <div style="height:7px;background:#cfd4df;border-radius:99px;overflow:hidden;border:1px solid rgba(0,0,0,0.12)">
                <div id="ipodSeekFill" style="height:100%;background:linear-gradient(90deg,#3b82f6,#1d4ed8);width:${Math.min(100, (state.currentTime / Math.max(1, state.duration)) * 100)}%"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;margin-top:4px">
                <span class="js-cur-time">${formatTime(state.currentTime)}</span>
                <span class="js-dur-time">-${formatTime(Math.max(0, state.duration - state.currentTime))}</span>
              </div>
            </div>
          </div>
          <div class="ipod-wheel">
            <button class="ipod-wheel-label top" data-action="cycle-style">MENU</button>
            <button class="ipod-wheel-label left" data-action="prev">⏮</button>
            <button class="ipod-wheel-label right" data-action="next">⏭</button>
            <button class="ipod-wheel-label bottom" data-action="toggle-play">⏯</button>
            <button class="ipod-center-btn press" data-action="toggle-play" title="Play / Pause"></button>
          </div>
        </div>
        ${renderPlayerBottomPillHtml()}
      `;
      return;
    }

    playerSheet.innerHTML = `
      <div class="player-handle-row">
        <button class="icon-circle-btn press" data-action="close-player" title="Minimize">⌄</button>
        <div class="sheet-grabber"></div>
        <button class="icon-circle-btn press" data-action="cycle-style" title="Switch Player Style (${state.playerStyle})">✦</button>
      </div>

      <!-- Dynamic Stage: Cover / Turntable / Flowing Lyrics / Quick DSP -->
      <div id="playerCenterStage">
        ${renderPlayerStageHtml(cur, isPlaying)}
      </div>

      <div>
        <div class="player-meta-row">
          <div class="player-title-wrap">
            <div class="player-title-line">
              <h2 class="player-song-title" id="playerSongTitle">${escapeHtml(cur.title)}</h2>
              <span class="codec-pill" id="playerCodecBadge">${escapeHtml(cur.codec || 'OPUS')}</span>
            </div>
            <p class="player-song-artist" id="playerSongArtist">${escapeHtml(cur.artist)}</p>
          </div>
          <div style="display:flex;gap:8px">
            <button class="icon-circle-btn press ${cur.liked ? 'active' : ''}" data-action="toggle-like" data-id="${escapeHtml(cur.id)}" title="Favorite">
              ${cur.liked ? '♥' : '♡'}
            </button>
            <button class="icon-circle-btn press" data-action="go-audiolab" title="Open Audio Lab">ılı</button>
          </div>
        </div>

        <div class="player-seek-wrap">
          <input id="playerSeekInput" class="mochy-range" type="range" min="0" max="${Math.max(1, Math.floor(state.duration))}" step="0.2" value="${state.currentTime}">
          <div class="player-time-row">
            <span class="js-cur-time">${formatTime(state.currentTime)}</span>
            <span style="font-size:10.5px;color:var(--accent)">${state.eq.enabled ? 'EQ' : ''}${state.reverb.enabled ? ' · REVERB' : ''}${state.spatial.enabled ? ' · SPATIAL' : ''}</span>
            <span class="js-dur-time">${formatTime(state.duration)}</span>
          </div>
        </div>

        <div class="player-transport-row">
          <button class="transport-btn press" data-action="prev" title="Previous">
            <svg viewBox="0 0 24 24"><path d="M19 6L9 12l10 6V6zM5 6h2v12H5V6z"/></svg>
          </button>
          <button class="transport-btn play-main press" data-action="toggle-play" id="mainPlayBtn" title="Play / Pause">
            ${isPlaying
              ? `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>`
              : `<svg viewBox="0 0 24 24"><path d="M7 5.5v13l11-6.5-11-6.5z"/></svg>`}
          </button>
          <button class="transport-btn press" data-action="next" title="Next">
            <svg viewBox="0 0 24 24"><path d="M5 6l10 6-10 6V6zm12 0h2v12h-2V6z"/></svg>
          </button>
        </div>

        ${renderPlayerBottomPillHtml()}
      </div>
    `;

    const seekInput = document.getElementById('playerSeekInput');
    if (seekInput) {
      seekInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.currentTime = val;
        if (audioEl.src) audioEl.currentTime = val;
        syncActiveLyrics();
      });
    }

    if (state.playerBottomMode === 'lyrics' || state.playerStyle === 'LYRICS') {
      renderLyricsStage();
    }
  }

  function renderPlayerStageHtml(cur, isPlaying) {
    if (state.playerStyle === 'LYRICS' || state.playerBottomMode === 'lyrics') {
      return `
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:10px">
              <img src="${escapeHtml(cur.artwork)}" alt="" style="width:40px;height:40px;border-radius:10px;object-fit:cover">
              <div style="font-size:11.5px;color:var(--soft);font-weight:700">${escapeHtml(state.lyricsProvider)}</div>
            </div>
            <button class="filter-chip press ${state.romanizeLyrics ? 'active' : ''}" style="padding:4px 10px;font-size:11px" data-action="toggle-romanize">Romaji / Roman</button>
          </div>
          <div class="lyrics-stage" id="lyricsStage"></div>
        </div>
      `;
    }

    if (state.playerBottomMode === 'dsp') {
      return `
        <div class="lab-card" style="margin:6px 0 14px">
          <div class="lab-toggle-row" style="margin-bottom:8px">
            <div>
              <h4 style="font-size:15px">Quick Audio Lab</h4>
              <p>${state.eq.enabled ? 'Parametric EQ Active' : 'EQ Bypassed'} · ${state.reverb.enabled ? 'Reverb Active' : 'Reverb Off'}</p>
            </div>
            <button class="filter-chip press" data-action="go-audiolab">Full Lab ›</button>
          </div>
          <div class="chip-bar" style="padding:4px 0 10px">
            ${DATA.eqPresets.slice(0, 8).map(p => `
              <button class="filter-chip press ${state.eq.presetId === p.id ? 'active' : ''}" data-action="apply-eq-preset" data-preset="${p.id}">${p.name}</button>
            `).join('')}
          </div>
          <div class="lab-toggle-row" style="margin-top:6px">
            <div><h4 style="font-size:14px">Freeverb Room</h4></div>
            <button class="mochy-switch ${state.reverb.enabled ? 'on' : ''}" data-action="toggle-reverb"><span></span></button>
          </div>
          <div class="chip-bar" style="padding:8px 0 2px">
            ${DATA.reverbPresets.map(p => `
              <button class="filter-chip press ${state.reverb.presetId === p.id ? 'active' : ''}" data-action="apply-reverb-preset" data-preset="${p.id}">${p.name}</button>
            `).join('')}
          </div>
          <div class="lab-slider-row">
            <div class="lab-slider-head"><span>Playback Speed</span><span id="quickSpeedVal">${state.playbackSpeed.toFixed(2)}x</span></div>
            <input class="mochy-range" type="range" min="0.5" max="2.0" step="0.05" value="${state.playbackSpeed}" id="quickSpeedSlider">
          </div>
        </div>
      `;
    }

    if (state.playerBottomMode === 'queue') {
      return `
        <div class="lyrics-stage" style="mask-image:none;-webkit-mask-image:none;padding:6px 0">
          ${state.queue.map((t, idx) => renderSongRowHtml(t, idx, cur && cur.id === t.id)).join('')}
        </div>
      `;
    }

    if (state.playerStyle === 'TURNTABLE') {
      return `
        <div class="player-cover-stage" style="background:radial-gradient(circle,#232329,#0e0e11)">
          <div class="turntable-disc ${isPlaying ? 'spinning' : ''}" id="turntableDisc">
            <img src="${escapeHtml(cur.artwork)}" alt="${escapeHtml(cur.title)}">
          </div>
        </div>
      `;
    }

    return `
      <div class="player-cover-stage ${isPlaying ? 'playing' : ''}">
        <img class="main-cover" id="playerCoverImg" src="${escapeHtml(cur.artwork)}" alt="${escapeHtml(cur.title)}">
      </div>
    `;
  }

  function renderPlayerBottomPillHtml() {
    const modes = [
      { id: 'cover', label: 'Cover' },
      { id: 'lyrics', label: 'Lyrics' },
      { id: 'dsp', label: 'Audio Lab' },
      { id: 'queue', label: 'Queue' }
    ];
    return `
      <div class="player-bottom-card">
        <div class="player-dots">
          <span class="${state.playerBottomMode === 'cover' ? 'on' : ''}"></span>
          <span class="${state.playerBottomMode === 'lyrics' ? 'on' : ''}"></span>
          <span class="${state.playerBottomMode === 'dsp' ? 'on' : ''}"></span>
        </div>
        <div class="player-pill-tabs">
          ${modes.map(m => `
            <button class="press ${state.playerBottomMode === m.id ? 'active' : ''}" data-action="set-player-mode" data-mode="${m.id}">${m.label}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderLyricsStage() {
    const stage = document.getElementById('lyricsStage');
    if (!stage) return;
    if (state.lyricsLoading) {
      stage.innerHTML = `<div class="lyric-line active">Loading word-synced lyrics…</div>`;
      return;
    }
    stage.innerHTML = state.lyricsLines.map((line, i) => `
      <div class="lyric-line ${i === state.activeLyricIndex ? 'active' : Math.abs(i - state.activeLyricIndex) === 1 ? 'near' : ''}"
           data-action="seek-lyric" data-time="${line.timeMs / 1000}" id="lyric-line-${i}">
        <div>
          ${(line.words || []).map((w, wi) => `
            <span class="lyric-word" id="lyric-word-${i}-${wi}">${escapeHtml(w.text)}</span>
          `).join('')}
        </div>
        ${state.romanizeLyrics && line.roman ? `<span class="lyric-roman">${escapeHtml(line.roman)}</span>` : ''}
      </div>
    `).join('');
    syncActiveLyrics(true);
  }

  function syncActiveLyrics(forceScroll = false) {
    const nowMs = state.currentTime * 1000;
    const lines = state.lyricsLines;
    if (!lines || lines.length === 0) return;

    let activeIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (nowMs >= lines[i].timeMs - 120) activeIdx = i;
      else break;
    }

    const changedLine = activeIdx !== state.activeLyricIndex;
    state.activeLyricIndex = activeIdx;

    const stage = document.getElementById('lyricsStage');
    if (!stage) return;

    if (changedLine || forceScroll) {
      lines.forEach((_, i) => {
        const el = document.getElementById(`lyric-line-${i}`);
        if (!el) return;
        el.classList.toggle('active', i === activeIdx);
        el.classList.toggle('near', Math.abs(i - activeIdx) === 1);
      });
      const activeEl = document.getElementById(`lyric-line-${activeIdx}`);
      if (activeEl) {
        const targetScroll = activeEl.offsetTop - stage.clientHeight * 0.34;
        stage.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
      }
    }

    // Word-by-word glow update on active line
    const activeLine = lines[activeIdx];
    if (activeLine && activeLine.words) {
      activeLine.words.forEach((w, wi) => {
        const wEl = document.getElementById(`lyric-word-${activeIdx}-${wi}`);
        if (!wEl) return;
        const sung = nowMs >= w.timeMs - 80;
        wEl.classList.toggle('sung', sung);
        wEl.classList.toggle('unsung', !sung);
      });
    }
  }

  function updatePlayerMetaUI() {
    const cur = currentTrack();
    if (!cur) return;
    const miniArt = document.getElementById('miniArt');
    const miniTitle = document.getElementById('miniTitle');
    const miniArtist = document.getElementById('miniArtist');
    if (miniArt) miniArt.src = cur.artwork;
    if (miniTitle) miniTitle.textContent = cur.title;
    if (miniArtist) miniArtist.textContent = cur.artist;

    renderPlayerSheet();
  }

  function updateTransportIcons() {
    const miniPlayBtn = document.getElementById('miniPlayBtn');
    if (miniPlayBtn) {
      miniPlayBtn.innerHTML = state.isPlaying
        ? `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>`
        : `<svg viewBox="0 0 24 24"><path d="M7 5.5v13l11-6.5-11-6.5z"/></svg>`;
    }
    const mainPlayBtn = document.getElementById('mainPlayBtn');
    if (mainPlayBtn) {
      mainPlayBtn.innerHTML = state.isPlaying
        ? `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>`
        : `<svg viewBox="0 0 24 24"><path d="M7 5.5v13l11-6.5-11-6.5z"/></svg>`;
    }
    const disc = document.getElementById('turntableDisc');
    if (disc) disc.classList.toggle('spinning', state.isPlaying);
  }

  function updateProgressUI() {
    const pct = Math.min(100, (state.currentTime / Math.max(1, state.duration)) * 100);
    const miniFill = document.getElementById('miniProgressFill');
    if (miniFill) miniFill.style.width = `${pct}%`;

    const seekInput = document.getElementById('playerSeekInput');
    if (seekInput && document.activeElement !== seekInput) {
      seekInput.max = Math.max(1, Math.floor(state.duration));
      seekInput.value = state.currentTime;
    }

    document.querySelectorAll('.js-cur-time').forEach(el => { el.textContent = formatTime(state.currentTime); });
    document.querySelectorAll('.js-dur-time').forEach(el => { el.textContent = formatTime(state.duration); });
  }

  // ---- Interactive Parametric EQ Canvas Dragging ----------------------------
  function bindEqCanvasInteractions() {
    const canvas = document.getElementById('eqGraphCanvas');
    if (!canvas) return;
    let draggingNode = -1;

    function posToFreqGain(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const left = 34, right = rect.width - 14, top = 16, bottom = rect.height - 24;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const normX = Math.max(0, Math.min(1, (x - left) / (right - left)));
      const normY = Math.max(0, Math.min(1, (y - top) / (bottom - top)));
      const freq = Math.pow(10, DSP.MIN_LOG + normX * (DSP.MAX_LOG - DSP.MIN_LOG));
      const gain = DSP.GRAPH_RANGE_DB - normY * 2 * DSP.GRAPH_RANGE_DB;
      return { x, y, left, right, top, bottom, freq, gain };
    }

    function findNearestNode(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const left = 34, right = rect.width - 14, top = 16, bottom = rect.height - 24;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let best = -1, bestDist = 28;
      state.eq.nodes.forEach((n, idx) => {
        const nx = left + ((Math.log10(n.frequency) - DSP.MIN_LOG) / (DSP.MAX_LOG - DSP.MIN_LOG)) * (right - left);
        const ng = (n.filterType === 'LPQ' || n.filterType === 'HPQ') ? 0 : n.gain;
        const ny = top + ((DSP.GRAPH_RANGE_DB - ng) / (2 * DSP.GRAPH_RANGE_DB)) * (bottom - top);
        const d = Math.hypot(px - nx, py - ny);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      });
      return best;
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (state.audioLabSubpage !== 'equalizer') {
        state.audioLabSubpage = 'equalizer';
        renderMainView();
        return;
      }
      const hit = findNearestNode(e.clientX, e.clientY);
      if (hit >= 0) {
        draggingNode = hit;
        state.eq.selectedNode = hit;
        canvas.setPointerCapture(e.pointerId);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (draggingNode < 0) return;
      const { freq, gain } = posToFreqGain(e.clientX, e.clientY);
      const node = state.eq.nodes[draggingNode];
      if (!node) return;
      node.frequency = Math.round(Math.max(20, Math.min(20000, freq)));
      if (node.filterType !== 'LPQ' && node.filterType !== 'HPQ') {
        node.gain = Math.round(Math.max(-12, Math.min(12, gain)) * 10) / 10;
      }
      state.eq.presetId = null;
      const fEl = document.getElementById('eqFreqVal');
      const gEl = document.getElementById('eqGainVal');
      if (fEl) fEl.textContent = `${node.frequency} Hz`;
      if (gEl) gEl.textContent = `${(node.gain >= 0 ? '+' : '') + node.gain.toFixed(1)} dB`;
      pushAllDspToEngine();
    });

    canvas.addEventListener('pointerup', () => {
      if (draggingNode >= 0) {
        draggingNode = -1;
        renderMainView();
      }
    });
  }

  function bindEqSliders() {
    mainPane.querySelectorAll('input[data-slider]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const kind = inp.dataset.slider;
        const selIdx = state.eq.selectedNode || 0;
        const node = state.eq.nodes[selIdx];
        const val = parseFloat(e.target.value);

        if (kind === 'node-freq' && node) {
          node.frequency = Math.round(Math.pow(10, val));
          const el = document.getElementById('eqFreqVal');
          if (el) el.textContent = `${node.frequency} Hz`;
        } else if (kind === 'node-gain' && node) {
          node.gain = val;
          state.eq.presetId = null;
          const el = document.getElementById('eqGainVal');
          if (el) el.textContent = `${(val >= 0 ? '+' : '') + val.toFixed(1)} dB`;
        } else if (kind === 'node-q' && node) {
          node.q = val;
          const el = document.getElementById('eqQVal');
          if (el) el.textContent = val.toFixed(2);
        } else if (kind === 'eq-preamp') {
          state.eq.preamp = val;
          const el = document.getElementById('preampVal');
          if (el) el.textContent = `${(val >= 0 ? '+' : '') + val.toFixed(1)} dB`;
        } else if (kind === 'band-gain') {
          const bIdx = parseInt(inp.dataset.index, 10);
          if (state.eq.nodes[bIdx]) {
            state.eq.nodes[bIdx].gain = val;
            state.eq.presetId = null;
            const el = document.getElementById(`bandGainVal-${bIdx}`);
            if (el) el.textContent = `${(val >= 0 ? '+' : '') + val.toFixed(1)} dB`;
          }
        }
        pushAllDspToEngine();
      });
    });
  }

  function bindFxSliders() {
    mainPane.querySelectorAll('input[data-reverb]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const key = inp.dataset.reverb;
        const val = parseFloat(e.target.value);
        state.reverb[key] = val;
        state.reverb.presetId = null;
        state.reverb.enabled = true;
        const labelMap = {
          mix: ['revMixVal', `${Math.round(val * 100)}%`],
          roomSize: ['revRoomVal', `${Math.round(val * 100)}%`],
          damping: ['revDampVal', `${Math.round(val * 100)}%`],
          wet: ['revWetVal', `${Math.round(val * 100)}%`],
          dry: ['revDryVal', `${Math.round(val * 100)}%`],
          width: ['revWidthVal', `${Math.round(val * 100)}%`],
          preDelayMs: ['revPredelayVal', `${Math.round(val)} ms`],
          lowCutHz: ['revLowcutVal', `${Math.round(val)} Hz`]
        };
        if (labelMap[key]) {
          const el = document.getElementById(labelMap[key][0]);
          if (el) el.textContent = labelMap[key][1];
        }
        pushAllDspToEngine();
      });
    });

    mainPane.querySelectorAll('input[data-spatial]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const key = inp.dataset.spatial;
        const val = parseFloat(e.target.value);
        state.spatial[key] = val;
        state.spatial.enabled = true;
        if (key === 'amount') {
          const el = document.getElementById('spatAmtVal');
          if (el) el.textContent = `${Math.round(val * 100)}%`;
        } else if (key === 'speakerAngle') {
          const el = document.getElementById('spatAngleVal');
          if (el) el.textContent = `±${Math.round(val)}°`;
        } else if (key === 'cutoffHz') {
          const el = document.getElementById('spatCutoffVal');
          if (el) el.textContent = `${Math.round(val)} Hz`;
        } else if (key === 'feedDb') {
          const el = document.getElementById('spatFeedVal');
          if (el) el.textContent = `${val.toFixed(1)} dB`;
        }
        pushAllDspToEngine();
      });
    });

    mainPane.querySelectorAll('input[data-loudness]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const key = inp.dataset.loudness;
        const val = parseFloat(e.target.value);
        state.loudness[key] = val;
        state.loudness.enabled = true;
        if (key === 'boostDb') {
          const el = document.getElementById('loudBoostVal');
          if (el) el.textContent = `+${val.toFixed(1)} dB`;
        } else if (key === 'compression') {
          const el = document.getElementById('loudCompVal');
          if (el) el.textContent = `${Math.round(val * 100)}%`;
        }
        pushAllDspToEngine();
      });
    });
  }

  // ---- Modals (Recap Story, CSV/Playlist Importer, Apple Music Connect) -----
  function renderModal() {
    const existing = document.getElementById('mochyModal');
    if (existing) existing.remove();
    if (!state.modal) return;

    const modalEl = document.createElement('div');
    modalEl.id = 'mochyModal';
    modalEl.className = 'modal-backdrop';

    if (state.modal === 'recap') {
      modalEl.innerHTML = `
        <div class="modal-sheet">
          <h2 style="margin:0 0 14px;font-size:26px;font-weight:800">Show by</h2>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
            <div style="padding:14px 16px;border-radius:16px;background:#3a3a40;border:1px solid rgba(255,255,255,0.22);display:flex;justify-content:space-between;font-weight:800">
              <span>◉ Month</span><span style="color:var(--soft);font-size:12px">Selected</span>
            </div>
            <div style="padding:14px 16px;border-radius:16px;background:#242428;font-weight:800">○ Year</div>
          </div>
          <h3 style="margin:0 0 10px;font-size:22px;font-weight:800">What year?</h3>
          <div style="padding:12px;border-radius:99px;border:1px solid var(--line);text-align:center;font-weight:800;margin-bottom:18px">2026</div>
          <h3 style="margin:0 0 10px;font-size:22px;font-weight:800">What month?</h3>
          <div style="padding:12px;border-radius:99px;border:1px solid var(--line);text-align:center;font-weight:800;margin-bottom:18px">November (this month)</div>
          <button class="hero-pill-btn press" style="width:100%;justify-content:center" data-action="close-modal">Done</button>
        </div>
      `;
    } else if (state.modal === 'apple-connect' || state.modal === 'import') {
      modalEl.innerHTML = `
        <div class="modal-sheet">
          <h2 style="margin:0 0 6px;font-size:22px;font-weight:800">Import to Library</h2>
          <p style="margin:0 0 14px;font-size:13px;color:var(--soft)">Paste a list of songs (<code>Artist - Title</code> or CSV) or import from your streaming library:</p>
          <textarea id="csvImportBox" rows="5" placeholder="Egzod - Royalty&#10;Daft Punk - Instant Crush&#10;YOASOBI - Idol&#10;The Weeknd - Starboy"
            style="width:100%;background:#121215;border:1px solid var(--line);border-radius:14px;padding:12px;color:#fff;font-family:var(--font);margin-bottom:14px"></textarea>
          <div style="display:flex;gap:10px">
            <button class="hero-pill-btn secondary press" style="flex:1;justify-content:center" data-action="close-modal">Cancel</button>
            <button class="hero-pill-btn press" style="flex:1;justify-content:center" data-action="run-csv-import">Import Tracks</button>
          </div>
        </div>
      `;
    }

    document.body.appendChild(modalEl);
  }

  // ---- Global Delegated Click Handler ---------------------------------------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'toggle-like') {
      e.stopPropagation();
      const id = btn.dataset.id;
      const track = state.queue.find(t => t.id === id);
      if (track) {
        track.liked = !track.liked;
        saveState();
        renderMainView();
        renderPlayerSheet();
      }
      return;
    }

    switch (action) {
      case 'play-index': {
        const idx = parseInt(btn.dataset.index, 10);
        await loadAndPlayTrack(idx, true);
        break;
      }
      case 'play-id': {
        const idx = state.queue.findIndex(t => t.id === btn.dataset.id);
        if (idx >= 0) await loadAndPlayTrack(idx, true);
        break;
      }
      case 'play-search-result': {
        const rIdx = parseInt(btn.dataset.resultIndex, 10);
        const item = state.searchResults[rIdx];
        if (item) {
          let existing = state.queue.findIndex(q => q.id === item.id);
          if (existing < 0) {
            state.queue.unshift(item);
            existing = 0;
          }
          await loadAndPlayTrack(existing, true);
        }
        break;
      }
      case 'pick-mood': {
        const q = btn.dataset.query || '';
        triggerSearch(q);
        break;
      }
      case 'clear-search': {
        triggerSearch('');
        break;
      }
      case 'toggle-play': {
        e.stopPropagation();
        await togglePlay();
        break;
      }
      case 'next': {
        e.stopPropagation();
        skipNext();
        break;
      }
      case 'prev': {
        e.stopPropagation();
        skipPrev();
        break;
      }
      case 'open-player': {
        state.playerSheetOpen = true;
        playerSheet.classList.add('open');
        renderPlayerSheet();
        break;
      }
      case 'close-player': {
        state.playerSheetOpen = false;
        playerSheet.classList.remove('open');
        break;
      }
      case 'cycle-style': {
        const styles = ['FLAGSHIP', 'LYRICS', 'TURNTABLE', 'IPOD'];
        const nextIdx = (styles.indexOf(state.playerStyle) + 1) % styles.length;
        state.playerStyle = styles[nextIdx];
        saveState();
        renderPlayerSheet();
        break;
      }
      case 'set-player-mode': {
        state.playerBottomMode = btn.dataset.mode;
        renderPlayerSheet();
        const speedSlider = document.getElementById('quickSpeedSlider');
        if (speedSlider) {
          speedSlider.addEventListener('input', (ev) => {
            state.playbackSpeed = parseFloat(ev.target.value);
            audioEl.playbackRate = state.playbackSpeed;
            const lbl = document.getElementById('quickSpeedVal');
            if (lbl) lbl.textContent = `${state.playbackSpeed.toFixed(2)}x`;
          });
        }
        break;
      }
      case 'seek-lyric': {
        const sec = parseFloat(btn.dataset.time);
        if (isFinite(sec)) {
          state.currentTime = sec;
          if (audioEl.src) audioEl.currentTime = sec;
          syncActiveLyrics(true);
        }
        break;
      }
      case 'toggle-romanize': {
        state.romanizeLyrics = !state.romanizeLyrics;
        saveState();
        renderMainView();
        renderPlayerSheet();
        break;
      }
      case 'shuffle-all': {
        const rnd = Math.floor(Math.random() * state.queue.length);
        await loadAndPlayTrack(rnd, true);
        break;
      }
      case 'set-lib-filter': {
        state.libraryFilter = btn.dataset.filter;
        renderMainView();
        break;
      }
      case 'upload-local': {
        document.getElementById('localFileInput')?.click();
        break;
      }
      case 'open-audiolab':
      case 'go-audiolab': {
        state.playerSheetOpen = false;
        playerSheet.classList.remove('open');
        setTab('audiolab');
        break;
      }
      case 'go-stats': {
        setTab('stats');
        break;
      }
      case 'go-settings': {
        setTab('settings');
        break;
      }
      case 'audiolab-sub': {
        state.audioLabSubpage = btn.dataset.sub;
        renderMainView();
        break;
      }
      case 'set-eq-tab': {
        state.eqTab = parseInt(btn.dataset.tab, 10);
        renderMainView();
        break;
      }
      case 'toggle-eq': {
        state.eq.enabled = !state.eq.enabled;
        pushAllDspToEngine();
        renderMainView();
        renderPlayerSheet();
        break;
      }
      case 'apply-eq-preset': {
        const preset = DATA.eqPresets.find(p => p.id === btn.dataset.preset);
        if (preset) {
          state.eq.enabled = true;
          state.eq.presetId = preset.id;
          state.eq.nodes = DATA.eqFrequencies.map((f, i) => ({
            frequency: f,
            gain: preset.gains[i] || 0,
            q: DATA.octaveQ,
            filterType: 'PK',
            enabled: true
          }));
          pushAllDspToEngine();
          renderMainView();
          renderPlayerSheet();
        }
        break;
      }
      case 'select-eq-node': {
        state.eq.selectedNode = parseInt(btn.dataset.index, 10);
        renderMainView();
        break;
      }
      case 'set-node-filter': {
        const node = state.eq.nodes[state.eq.selectedNode || 0];
        if (node) {
          node.filterType = btn.dataset.type;
          state.eq.presetId = null;
          pushAllDspToEngine();
          renderMainView();
        }
        break;
      }
      case 'toggle-autoeq': {
        state.eq.correctionEnabled = !state.eq.correctionEnabled;
        if (state.eq.correctionEnabled && !state.eq.correction) {
          state.eq.correction = DATA.autoEqCatalog[0];
        }
        pushAllDspToEngine();
        renderMainView();
        break;
      }
      case 'pick-autoeq': {
        const hp = DATA.autoEqCatalog[parseInt(btn.dataset.index, 10)];
        if (hp) {
          state.eq.enabled = true;
          state.eq.correctionEnabled = true;
          state.eq.correction = hp;
          pushAllDspToEngine();
          renderMainView();
        }
        break;
      }
      case 'toggle-reverb': {
        state.reverb.enabled = !state.reverb.enabled;
        pushAllDspToEngine();
        renderMainView();
        renderPlayerSheet();
        break;
      }
      case 'apply-reverb-preset': {
        const p = DATA.reverbPresets.find(r => r.id === btn.dataset.preset);
        if (p) {
          state.reverb = { ...state.reverb, ...p, presetId: p.id, enabled: true };
          pushAllDspToEngine();
          renderMainView();
          renderPlayerSheet();
        }
        break;
      }
      case 'toggle-spatial': {
        state.spatial.enabled = !state.spatial.enabled;
        pushAllDspToEngine();
        renderMainView();
        renderPlayerSheet();
        break;
      }
      case 'set-spatial-mode': {
        state.spatial.mode = btn.dataset.mode;
        state.spatial.enabled = true;
        pushAllDspToEngine();
        renderMainView();
        break;
      }
      case 'toggle-mono': {
        state.spatial.mono = !state.spatial.mono;
        state.spatial.enabled = true;
        pushAllDspToEngine();
        renderMainView();
        break;
      }
      case 'toggle-loudness': {
        state.loudness.enabled = !state.loudness.enabled;
        pushAllDspToEngine();
        renderMainView();
        break;
      }
      case 'toggle-layout': {
        state.wideLayout = !state.wideLayout;
        applyShellMode();
        renderMainView();
        break;
      }
      case 'open-modal': {
        state.modal = btn.dataset.modal;
        renderModal();
        break;
      }
      case 'close-modal': {
        state.modal = null;
        renderModal();
        break;
      }
      case 'run-csv-import': {
        const box = document.getElementById('csvImportBox');
        const lines = (box?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s*[-–,]\s*/);
          const artist = parts.length > 1 ? parts[0] : 'Imported Artist';
          const title = parts.length > 1 ? parts.slice(1).join(' - ') : parts[0];
          state.queue.unshift({
            id: 'imp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            title,
            artist,
            album: 'Imported Playlist',
            duration: 210,
            codec: 'Preview',
            source: 'Imported',
            artwork: DATA.seedTracks[Math.floor(Math.random() * DATA.seedTracks.length)].artwork,
            searchQuery: `${artist} ${title}`,
            imported: true,
            liked: true
          });
        }
        state.modal = null;
        renderModal();
        saveState();
        renderMainView();
        break;
      }
    }
  });

  // Bottom Navigation Pill Click
  document.querySelectorAll('.nav-pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  // Local Audio File Input Handler
  const fileInput = document.getElementById('localFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const cleanName = file.name.replace(/\.[^.]+$/, '');
        const ext = (file.name.split('.').pop() || 'AUDIO').toUpperCase();
        state.queue.unshift({
          id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          title: cleanName,
          artist: 'Local Audio File',
          album: 'On This Device',
          duration: 220,
          codec: ext,
          source: 'Local File',
          artwork: DATA.seedTracks[0].artwork,
          streamUrl: url,
          isBlob: true,
          liked: true
        });
      }
      await loadAndPlayTrack(0, true);
    });
  }

  // ---- 60fps Animation Loop for EQ Spectrum & Reverb Bouncing Waves ---------
  function animationFrameLoop(ts) {
    const t = ts / 1000;
    if (analyserNode && state.isPlaying) {
      analyserNode.getByteFrequencyData(analyserBuffer);
    } else {
      analyserBuffer.fill(0);
    }

    const eqCanvas = document.getElementById('eqGraphCanvas');
    if (eqCanvas) {
      DSP.drawEqGraph(eqCanvas, state.eq, state.isPlaying ? analyserBuffer : null);
    }

    const revCanvas = document.getElementById('reverbCanvas');
    if (revCanvas) {
      DSP.drawReverbPicture(revCanvas, state.reverb, t, state.audioLevel);
    }

    requestAnimationFrame(animationFrameLoop);
  }


  function normalize(value) { return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function playbackNotice(message) {
    let el = document.getElementById('playbackNotice');
    if (!el) { el = document.createElement('div'); el.id = 'playbackNotice'; el.setAttribute('role', 'status'); document.querySelector('.top-bar').after(el); }
    el.textContent = message;
  }
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && !event.target.dataset.fallback) {
      event.target.dataset.fallback = 'true'; event.target.src = '../assets/img/logo.svg';
    }
  }, true);
  let preferences;
  try { preferences = JSON.parse(localStorage.getItem('mochy_preferences_v1')); } catch {}
  let recommendations = [], recommendationStatus = '';
  function renderPersonalHome() {
    mainPane.innerHTML = `<section class="section-block"><h1 class="screen-title">Made for you</h1>
      ${!preferences ? `<p>Choose the artists and genres you enjoy. We’ll use them to find music for your home.</p>
      <form id="tasteForm"><label>Favorite artists (comma separated)<input class="taste-input" name="artists" placeholder="Adele, NIKI, Daft Punk" maxlength="200"></label>
      <label>Favorite genres (comma separated)<input class="taste-input" name="genres" placeholder="Pop, Jazz, Electronic" maxlength="120"></label>
      <p id="tasteError" role="status"></p><button class="hero-pill-btn" type="submit">Find my music</button></form>` :
      `<p>Inspired by ${escapeHtml([...preferences.artists,...preferences.genres].join(', '))}</p><button class="filter-chip" id="changeTaste">Edit preferences</button>
      <p role="status">${escapeHtml(recommendationStatus)}</p><button class="filter-chip" id="refreshRecommendations">Refresh recommendations</button>
      <div class="song-list">${recommendations.map((t,i)=>`<button class="song-row recommendation-row" data-rec="${i}"><img width="56" height="56" src="${escapeHtml(t.artwork)}" alt=""><span class="song-row-info"><span class="song-row-title">${escapeHtml(t.title)}</span><span class="song-row-sub">${escapeHtml(t.artist)} · Preview</span></span></button>`).join('')}</div>`}</section>`;
    document.getElementById('tasteForm')?.addEventListener('submit', e => {
      e.preventDefault(); const form = new FormData(e.target);
      const split = key => String(form.get(key)).split(',').map(x=>x.trim()).filter(Boolean).slice(0,4);
      const next = {artists:split('artists'),genres:split('genres')};
      if (!next.artists.length && !next.genres.length) { document.getElementById('tasteError').textContent='Enter at least one artist or genre.'; return; }
      preferences=next; try { localStorage.setItem('mochy_preferences_v1',JSON.stringify(next)); } catch { }
      loadRecommendations();
    });
    document.getElementById('changeTaste')?.addEventListener('click',()=>{preferences=null;renderPersonalHome();});
    document.getElementById('refreshRecommendations')?.addEventListener('click',loadRecommendations);
    mainPane.querySelectorAll('[data-rec]').forEach(el=>el.addEventListener('click',()=>{const t=recommendations[Number(el.dataset.rec)]; let i=state.queue.findIndex(x=>x.id===t.id); if(i<0){i=state.queue.push(t)-1;} loadAndPlayTrack(i);}));
  }
  async function loadRecommendations() {
    const taste = preferences;
    recommendationStatus='Finding music…'; if(state.activeTab==='home') renderPersonalHome();
    const results=await Promise.allSettled([...taste.artists,...taste.genres].map(async term=>{
      const response=await fetch('https://itunes.apple.com/search?entity=song&limit=12&term='+encodeURIComponent(term), {signal:AbortSignal.timeout(12000)});
      if(!response.ok) throw Error('Catalog unavailable');
      return (await response.json()).results.filter(t=>t.previewUrl && (taste.artists.some(a=>normalize(t.artistName).includes(normalize(a))) || taste.genres.some(g=>normalize(t.primaryGenreName || '').includes(normalize(g)))));
    }));
    if(preferences!==taste)return;
    const tracks=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    recommendations=[...new Map(tracks.map(t=>[t.trackId,{id:'apple-'+t.trackId,title:t.trackName,artist:t.artistName,album:t.collectionName,artwork:(t.artworkUrl100||'').replace('100x100bb','600x600bb'),streamUrl:t.previewUrl,source:'iTunes · Preview',codec:'Preview',duration:0}])).values()].slice(0,24);
    recommendationStatus=recommendations.length?'Catalog recommendations · audio previews, not full tracks.': 'No recommendations available. Try another artist or refresh. Your preferences are saved.';
    if(state.activeTab==='home')renderPersonalHome();
  }

  // ---- Initial Boot ---------------------------------------------------------
  if (preferences) loadRecommendations();
  applyShellMode();
  renderMainView();
  updatePlayerMetaUI();
  fetchLyricsForTrack(currentTrack());
  requestAnimationFrame(animationFrameLoop);
})();
