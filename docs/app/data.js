// docs/app/data.js
// Exact Built-In EQ Presets, Reverb Presets, AutoEq Headphone Profiles, Node Colors,
// and Initial Featured Catalog from Mochy Music Android (AudioLabStore.kt, ReverbSettings.kt, AudioLabKit.kt)

window.MOCHY_DATA = {
  eqFrequencies: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
  octaveQ: 1.41,

  nodeColors: [
    '#F28BA8', '#F2A46B', '#F2D46B', '#8FD98B', '#6BD9C4',
    '#6BBAF2', '#8C9EF2', '#B98CF2', '#E08CF2', '#F26B6B'
  ],

  filterTypes: [
    { id: 'PK', name: 'Peaking (PK)', short: 'PK' },
    { id: 'LSC', name: 'Low Shelf (LSC)', short: 'LSC' },
    { id: 'HSC', name: 'High Shelf (HSC)', short: 'HSC' },
    { id: 'LPQ', name: 'Low Pass (LPQ)', short: 'LPQ' },
    { id: 'HPQ', name: 'High Pass (HPQ)', short: 'HPQ' }
  ],

  eqPresets: [
    { id: 'flat', name: 'Flat', gains: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
    { id: 'acoustic', name: 'Acoustic', gains: [4.5, 4.5, 3.5, 1.0, 1.5, 1.5, 3.0, 3.5, 3.0, 1.5] },
    { id: 'bass_boost', name: 'Bass Booster', gains: [5.5, 4.5, 3.5, 2.5, 1.2, 0.0, 0.0, 0.0, 0.0, 0.0] },
    { id: 'bass_cut', name: 'Bass Reducer', gains: [-5.5, -4.5, -3.5, -2.5, -1.2, 0.0, 0.0, 0.0, 0.0, 0.0] },
    { id: 'classical', name: 'Classical', gains: [4.5, 3.5, 3.0, 2.5, -1.5, -1.5, 0.0, 2.0, 3.0, 3.5] },
    { id: 'dance', name: 'Dance', gains: [3.5, 6.5, 5.0, 0.0, 2.0, 3.5, 5.0, 4.5, 3.5, 0.0] },
    { id: 'deep', name: 'Deep', gains: [5.0, 3.5, 1.5, 1.0, 3.0, 2.5, 1.5, -2.0, -3.5, -4.5] },
    { id: 'electronic', name: 'Electronic', gains: [4.5, 4.0, 1.5, 0.0, -2.0, 2.0, 1.0, 1.5, 4.5, 5.0] },
    { id: 'hiphop', name: 'Hip-Hop', gains: [5.0, 4.0, 1.5, 3.0, -1.0, -1.0, 1.5, -0.5, 2.0, 3.0] },
    { id: 'jazz', name: 'Jazz', gains: [4.0, 3.0, 1.5, 2.0, -1.5, -1.5, 0.0, 1.5, 3.0, 3.5] },
    { id: 'loudness', name: 'Loudness', gains: [6.0, 4.0, 0.0, 0.0, -2.0, 0.0, -1.0, -5.0, 5.0, 1.0] },
    { id: 'lounge', name: 'Lounge', gains: [-3.0, -1.5, -0.5, 1.5, 4.0, 2.5, 0.0, -1.5, 2.0, 1.0] },
    { id: 'piano', name: 'Piano', gains: [3.0, 2.0, 0.0, 2.5, 3.0, 1.5, 3.5, 4.5, 3.0, 3.5] },
    { id: 'pop', name: 'Pop', gains: [-1.5, -1.0, 0.0, 2.0, 4.0, 4.0, 2.0, 0.0, -1.0, -1.5] },
    { id: 'rnb', name: 'R&B', gains: [2.5, 7.0, 5.5, 1.5, -2.5, -1.5, 2.5, 3.0, 3.0, 3.5] },
    { id: 'rock', name: 'Rock', gains: [5.0, 4.0, 3.0, 1.5, -0.5, -1.0, 0.5, 2.5, 3.5, 4.5] },
    { id: 'small_speakers', name: 'Small Speakers', gains: [5.5, 4.0, 3.5, 2.5, 1.0, 0.0, -1.0, -2.0, -3.5, -4.0] },
    { id: 'spoken', name: 'Spoken Word', gains: [-3.5, -0.5, 0.0, 0.5, 3.5, 4.5, 5.0, 4.0, 2.5, 0.0] },
    { id: 'treble_boost', name: 'Treble Booster', gains: [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 2.5, 3.5, 4.5, 5.5] },
    { id: 'treble_cut', name: 'Treble Reducer', gains: [0.0, 0.0, 0.0, 0.0, 0.0, -1.0, -2.5, -3.5, -4.5, -5.5] },
    { id: 'vocal', name: 'Vocal Booster', gains: [-1.5, -3.0, -3.0, 1.5, 3.5, 3.5, 3.0, 1.5, 0.0, -1.5] }
  ],

  reverbPresets: [
    { id: 'room', name: 'Room', mix: 0.5, roomSize: 0.55, damping: 0.45, wet: 0.6, dry: 1.0, width: 1.0, preDelayMs: 12, lowCutHz: 180 },
    { id: 'studio', name: 'Studio', mix: 0.4, roomSize: 0.3, damping: 0.65, wet: 0.45, dry: 1.0, width: 0.8, preDelayMs: 5, lowCutHz: 250 },
    { id: 'bathroom', name: 'Bathroom', mix: 0.5, roomSize: 0.42, damping: 0.05, wet: 0.7, dry: 1.0, width: 0.6, preDelayMs: 2, lowCutHz: 120 },
    { id: 'plate', name: 'Plate', mix: 0.45, roomSize: 0.65, damping: 0.1, wet: 0.55, dry: 1.0, width: 1.0, preDelayMs: 0, lowCutHz: 300 },
    { id: 'hall', name: 'Hall', mix: 0.5, roomSize: 0.78, damping: 0.35, wet: 0.6, dry: 1.0, width: 1.0, preDelayMs: 25, lowCutHz: 150 },
    { id: 'cathedral', name: 'Cathedral', mix: 0.55, roomSize: 0.95, damping: 0.2, wet: 0.7, dry: 1.0, width: 1.0, preDelayMs: 40, lowCutHz: 120 },
    { id: 'stadium', name: 'Stadium', mix: 0.6, roomSize: 0.9, damping: 0.5, wet: 0.65, dry: 1.0, width: 1.0, preDelayMs: 60, lowCutHz: 200 },
    { id: 'dream', name: 'Dreamy', mix: 0.7, roomSize: 0.93, damping: 0.6, wet: 0.85, dry: 1.0, width: 1.0, preDelayMs: 30, lowCutHz: 300 }
  ],

  autoEqCatalog: [
    {
      name: 'Apple AirPods Pro 2',
      source: 'oratory1990 ·HMS II.3',
      form: 'In-Ear',
      preamp: -4.2,
      filters: [
        { filterType: 'LSC', frequency: 105, gain: 2.1, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 210, gain: -1.8, q: 1.1, enabled: true },
        { filterType: 'PK', frequency: 920, gain: 1.4, q: 1.5, enabled: true },
        { filterType: 'PK', frequency: 2450, gain: 2.8, q: 1.8, enabled: true },
        { filterType: 'PK', frequency: 5200, gain: -2.4, q: 2.6, enabled: true },
        { filterType: 'HSC', frequency: 10000, gain: 3.1, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Apple AirPods Max',
      source: 'oratory1990 · GRAS 43AG-7',
      form: 'Over-Ear',
      preamp: -5.4,
      filters: [
        { filterType: 'LSC', frequency: 105, gain: 1.5, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 145, gain: -2.6, q: 1.4, enabled: true },
        { filterType: 'PK', frequency: 1150, gain: -2.0, q: 2.2, enabled: true },
        { filterType: 'PK', frequency: 2300, gain: 5.1, q: 1.7, enabled: true },
        { filterType: 'PK', frequency: 4400, gain: 3.4, q: 2.5, enabled: true },
        { filterType: 'HSC', frequency: 10000, gain: -1.8, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Sony WH-1000XM5',
      source: 'oratory1990 · GRAS 43AG-7',
      form: 'Over-Ear',
      preamp: -5.8,
      filters: [
        { filterType: 'LSC', frequency: 105, gain: -3.8, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 195, gain: -3.2, q: 1.1, enabled: true },
        { filterType: 'PK', frequency: 480, gain: 2.4, q: 1.3, enabled: true },
        { filterType: 'PK', frequency: 1550, gain: 3.8, q: 1.6, enabled: true },
        { filterType: 'PK', frequency: 3600, gain: 4.5, q: 2.1, enabled: true },
        { filterType: 'HSC', frequency: 9500, gain: 2.2, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Sony WF-1000XM5',
      source: 'Crinacle · 711',
      form: 'In-Ear',
      preamp: -4.6,
      filters: [
        { filterType: 'LSC', frequency: 105, gain: -1.2, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 280, gain: -2.1, q: 1.0, enabled: true },
        { filterType: 'PK', frequency: 1850, gain: 2.9, q: 1.5, enabled: true },
        { filterType: 'PK', frequency: 4300, gain: 4.2, q: 2.0, enabled: true },
        { filterType: 'HSC', frequency: 10500, gain: 2.5, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Sennheiser HD 650 / HD 6XX',
      source: 'oratory1990 · GRAS 43AG-7',
      form: 'Over-Ear',
      preamp: -6.5,
      filters: [
        { filterType: 'LSC', frequency: 75, gain: 6.2, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 165, gain: -2.3, q: 1.3, enabled: true },
        { filterType: 'PK', frequency: 1200, gain: -1.2, q: 2.1, enabled: true },
        { filterType: 'PK', frequency: 2150, gain: 2.4, q: 1.9, enabled: true },
        { filterType: 'PK', frequency: 3300, gain: -1.5, q: 3.0, enabled: true },
        { filterType: 'HSC', frequency: 9500, gain: 2.8, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Moondrop Blessing 3',
      source: 'Super Review · 711',
      form: 'In-Ear',
      preamp: -4.1,
      filters: [
        { filterType: 'LSC', frequency: 105, gain: 3.6, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 310, gain: 1.1, q: 1.3, enabled: true },
        { filterType: 'PK', frequency: 1450, gain: -1.6, q: 1.8, enabled: true },
        { filterType: 'PK', frequency: 3100, gain: -2.4, q: 2.2, enabled: true },
        { filterType: 'HSC', frequency: 10000, gain: -1.5, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Beyerdynamic DT 990 Pro',
      source: 'oratory1990 · GRAS 43AG-7',
      form: 'Over-Ear',
      preamp: -5.9,
      filters: [
        { filterType: 'LSC', frequency: 80, gain: 4.8, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 180, gain: -3.1, q: 1.1, enabled: true },
        { filterType: 'PK', frequency: 3200, gain: 2.2, q: 1.8, enabled: true },
        { filterType: 'PK', frequency: 6100, gain: -5.2, q: 3.4, enabled: true },
        { filterType: 'PK', frequency: 8800, gain: -6.4, q: 3.8, enabled: true }
      ]
    },
    {
      name: 'Samsung Galaxy Buds2 Pro',
      source: 'Crinacle · B&K 5128',
      form: 'In-Ear',
      preamp: -3.7,
      filters: [
        { filterType: 'LSC', frequency: 105, gain: -1.5, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 1400, gain: 1.6, q: 1.4, enabled: true },
        { filterType: 'PK', frequency: 2900, gain: -2.1, q: 2.0, enabled: true },
        { filterType: 'PK', frequency: 5800, gain: -3.0, q: 2.8, enabled: true },
        { filterType: 'HSC', frequency: 10500, gain: 1.8, q: 0.7, enabled: true }
      ]
    },
    {
      name: 'Truthear x Crinacle ZERO:RED',
      source: 'Crinacle · B&K 5128',
      form: 'In-Ear',
      preamp: -3.2,
      filters: [
        { filterType: 'LSC', frequency: 90, gain: 1.8, q: 0.7, enabled: true },
        { filterType: 'PK', frequency: 240, gain: -1.1, q: 1.4, enabled: true },
        { filterType: 'PK', frequency: 2800, gain: -1.5, q: 2.2, enabled: true },
        { filterType: 'HSC', frequency: 11000, gain: 2.4, q: 0.7, enabled: true }
      ]
    }
  ],

  moods: [
    { id: 'chill', title: 'Chill', query: 'chill lofi', bg: 'linear-gradient(135deg, #4b5568 0%, #2a303c 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/68/19/73/681973cc-bc80-fd47-05bd-1da1a3a57229/196871341769.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/09/7d/b0/097db06f-8403-3cf7-7510-139e570ca66b/196871665582.jpg/300x300bb.jpg' },
    { id: 'commute', title: 'Commute', query: 'feel good pop hits', bg: 'linear-gradient(135deg, #74642c 0%, #443a18 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/08/11/d2/0811d2b3-b4d5-c22a-f13e-35c690b6509f/886445911213.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/61/e2/92/61e29297-f6e0-64c4-0634-8d658a4ef19f/00602537473649.rgb.jpg/300x300bb.jpg' },
    { id: 'energize', title: 'Energize', query: 'Egzod Maestro Chives', bg: 'linear-gradient(135deg, #646144 0%, #3a3826 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/e7/34/d3e734c4-e916-6620-34e8-e5cd126f2b8b/5055199562934.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/7b/56/9c/7b569c06-5324-7b17-c21a-78e6383d59c9/886443673465.jpg/300x300bb.jpg' },
    { id: 'feelgood', title: 'Feel good', query: 'upbeat indie pop', bg: 'linear-gradient(135deg, #4f6454 0%, #2d3b30 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/2a/19/fb/2a19fb85-2f70-9e44-f2a9-822679b88e8f/23UMGIM71510.rgb.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/3e/04/a8/3e04a83b-87a7-e052-5582-b84c04a7d58b/196589564221.jpg/300x300bb.jpg' },
    { id: 'focus', title: 'Focus', query: 'ambient study piano', bg: 'linear-gradient(135deg, #52565c 0%, #2e3136 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e4/23/33/e4233381-c4e3-5539-5780-16992356a813/00028948377053.rgb.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/3c/29/a8/3c29a86d-85f0-6b4e-8b5a-3e0e5070e072/886445635850.jpg/300x300bb.jpg' },
    { id: 'gaming', title: 'Gaming', query: 'phonk trap electronic', bg: 'linear-gradient(135deg, #3c4254 0%, #222632 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/e7/34/d3e734c4-e916-6620-34e8-e5cd126f2b8b/5055199562934.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/09/7d/b0/097db06f-8403-3cf7-7510-139e570ca66b/196871665582.jpg/300x300bb.jpg' },
    { id: 'party', title: 'Party', query: 'Yellow Claw dance', bg: 'linear-gradient(135deg, #564568 0%, #31263d 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/9a/42/e5/9a42e526-9672-674e-b62c-16e1160f0394/190295689308.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/08/11/d2/0811d2b3-b4d5-c22a-f13e-35c690b6509f/886445911213.jpg/300x300bb.jpg' },
    { id: 'romance', title: 'Romance', query: 'romantic acoustic r&b', bg: 'linear-gradient(135deg, #683534 0%, #3d1d1c 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/61/e2/92/61e29297-f6e0-64c4-0634-8d658a4ef19f/00602537473649.rgb.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/68/19/73/681973cc-bc80-fd47-05bd-1da1a3a57229/196871341769.jpg/300x300bb.jpg' },
    { id: 'sad', title: 'Sad', query: 'melancholic indie ballad', bg: 'linear-gradient(135deg, #46464a 0%, #27272a 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/3e/04/a8/3e04a83b-87a7-e052-5582-b84c04a7d58b/196589564221.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e4/23/33/e4233381-c4e3-5539-5780-16992356a813/00028948377053.rgb.jpg/300x300bb.jpg' },
    { id: 'sleep', title: 'Sleep', query: 'classical sleep ambient', bg: 'linear-gradient(135deg, #463a64 0%, #272039 100%)', art1: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e4/23/33/e4233381-c4e3-5539-5780-16992356a813/00028948377053.rgb.jpg/300x300bb.jpg', art2: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/2a/19/fb/2a19fb85-2f70-9e44-f2a9-822679b88e8f/23UMGIM71510.rgb.jpg/300x300bb.jpg' }
  ],

  // Initial seed tracks matching Mochy's official screenshots (Royalty - Egzod, Unstoppable - Sia, Heart Attack - Demi Lovato, Yellow Claw, etc.)
  seedTracks: [
    {
      id: 'royalty-egzod',
      title: 'Royalty',
      artist: 'Egzod, Maestro Chives, Neoni',
      album: 'Royalty - Single',
      duration: 223,
      codec: 'OPUS',
      source: 'Audius / Apple',
      genre: 'Electronic',
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/e7/34/d3e734c4-e916-6620-34e8-e5cd126f2b8b/5055199562934.jpg/600x600bb.jpg',
      audiusId: '1jlg3VX',
      searchQuery: 'Egzod Maestro Chives Royalty',
      ambient: ['#35275e', '#141026'],
      liked: true
    },
    {
      id: 'unstoppable-sia',
      title: 'Unstoppable',
      artist: 'Sia',
      album: 'This Is Acting',
      duration: 217,
      codec: 'AAC 256',
      source: 'Apple Music',
      genre: 'Pop',
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/08/11/d2/0811d2b3-b4d5-c22a-f13e-35c690b6509f/886445911213.jpg/600x600bb.jpg',
      searchQuery: 'Sia Unstoppable',
      ambient: ['#4a3b32', '#1a1412'],
      liked: true
    },
    {
      id: 'heart-attack-demi',
      title: 'Heart Attack',
      artist: 'Demi Lovato',
      album: 'Demi',
      duration: 210,
      codec: 'AAC 256',
      source: 'Apple Music',
      genre: 'Pop',
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/61/e2/92/61e29297-f6e0-64c4-0634-8d658a4ef19f/00602537473649.rgb.jpg/600x600bb.jpg',
      searchQuery: 'Demi Lovato Heart Attack',
      ambient: ['#383b42', '#141518'],
      liked: false
    },
    {
      id: 'danger-days-yc',
      title: 'DRXGS',
      artist: 'Yellow Claw',
      album: 'Danger Days EP',
      duration: 196,
      codec: 'FLAC',
      source: 'Audius / Apple',
      genre: 'Dance',
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/9a/42/e5/9a42e526-9672-674e-b62c-16e1160f0394/190295689308.jpg/600x600bb.jpg',
      searchQuery: 'Yellow Claw Danger Days',
      ambient: ['#5c1f19', '#1e0b09'],
      liked: true
    },
    {
      id: 'blinding-lights-weeknd',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      album: 'After Hours',
      duration: 200,
      codec: 'AAC 256',
      source: 'Apple Music',
      genre: 'R&B',
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/2b/b9/fe/2bb9fef5-d8f3-8342-25b9-d0d99e2e207e/20UMGIM11048.rgb.jpg/600x600bb.jpg',
      searchQuery: 'The Weeknd Blinding Lights',
      ambient: ['#5a1c24', '#1d090c'],
      liked: true
    },
    {
      id: 'idol-yoasobi',
      title: 'Idol (アイドル)',
      artist: 'YOASOBI',
      album: 'THE BOOK 3',
      duration: 213,
      codec: 'FLAC',
      source: 'Apple Music',
      genre: 'J-Pop',
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/91/75/7c/91757c29-2f48-44bd-485b-51d2e3d06d44/197188732769.jpg/600x600bb.jpg',
      searchQuery: 'YOASOBI Idol',
      ambient: ['#5e1f4c', '#1f0a19'],
      liked: true
    }
  ]
};
