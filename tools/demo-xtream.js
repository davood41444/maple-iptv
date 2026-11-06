/*
 * A pretend Xtream Codes server for trying the interface in a browser with a
 * realistic amount of content: add an Xtream playlist with server
 * http://localhost:8080/demo, username "demo", password "demo".
 *
 * Posters and channel logos are generated SVGs; every stream plays one of a
 * few public test videos.
 */
'use strict';

// Names like a real provider's list, to test long names and odd characters.
// DEMO_SHOWCASE=1 uses made-up names instead, for the website's screenshots (tools/site-shots.js).
const SHOWCASE = process.env.DEMO_SHOWCASE === '1';
const LIVE_GROUPS = SHOWCASE ? ['News', 'Sports', 'Movies', 'Series', 'Music', 'Kids', 'Documentary', 'Persian', 'Comedy', '4K UHD']
  : ['PERSIAN', 'GEM GROUP', 'IRIB', 'AFGHANESTAN', '4K - UHD', 'NEWS', 'MUSIC', 'KIDS', 'SPORT - VIP', 'UEFA CHAMPIONS LEAGUE'];
const CHANNEL_NAMES = SHOWCASE ? ['Lumen TV', 'Maple News HD', 'City 24', 'Northern Lights TV', 'Arena Sports 1 FHD', 'Arena Sports 2 HD',
  'Cinema One HD', 'Cinema Classics', 'Melody TV', 'Kids Planet', 'Wild Earth HD', 'Laugh Track TV', 'Docu World', 'Ocean Drive HD',
  'Metro Family', 'Skyline Drama', 'Retro Hits', 'Velocity Motors', 'Kitchen Stories', 'Global Travel HD']
  : ['MUSIC HUB', 'Radio Javan FHD', 'Radio Javan SD', 'PMC FHD', 'PMC HD', 'PMC ROYALE HD', 'PMC SELECT', 'PMC PLANETA',
    'T2 HD', 'AVANG TV HD', 'SUN MUSIC TV FHD', 'MANOTO HD', 'IRAN INTERNATIONAL FHD', 'GEM TV HD', 'GEM RIVER', 'GEM SERIES FHD',
    'SKY SPORTS PREMIER LEAGUE FHD (Backup)', 'beIN SPORTS MAX 4 FHD ᴿᴬᵂ 60fps', 'BBC PERSIAN', 'VOA PERSIAN HD'];
const VOD_GROUPS = SHOWCASE ? ['New Releases', 'Action', 'Drama', 'Family', 'Persian Cinema']
  : ['HOLLYWOOD MOVIES', 'PERSIAN MOVIES', 'PERSIAN SUBBED MOVIES', 'PERSIAN DUBBED MOVIES', 'PERSIAN SUB & DUB CLASSIC MOVIES'];
const MOVIE_NAMES = SHOWCASE ? ['Northern Harbor', 'The Glass Orchard', 'Last Train to Lumen', 'Paper Kingdoms', 'Salt & Saffron',
  'The Quiet Summit', 'Echoes of Amber', 'Red Lantern Street', 'Silver Coast', 'A House by the River', 'The Ninth Window',
  'Winter Garden', 'Falling Upward', 'Night Market', 'The Cartographer', 'Borrowed Light']
  : ['The Dressmaker', 'The Cycle', 'King of Kings', 'Carmen', '50 First Dates', 'Undercurrent', 'Snitch',
    'My Nanny Stole My Life', 'Queen at Sea', 'Love Language', 'Crawlers', 'Clean Hands', 'Night Shift', 'The Long Road Home',
    'Bloodsport', 'A Very Long Movie Title That Does Not Fit On One Line'];
const SERIES_GROUPS = SHOWCASE ? ['Drama Series', 'Comedy', 'Persian Series', 'Turkish Series', 'Documentary']
  : ['ENGLISH SERIES', 'PERSIAN SERIES', 'PERSIAN SUBBED SERIES', 'PERSIAN DUBBED SERIES', 'TURKISH SERIES SUBBED'];
const SERIES_NAMES = SHOWCASE ? ['Harbor Lights', 'The Saffron Road', 'Blue District', 'Old Town Tales', 'Second Chances',
  'The Lighthouse Keepers', 'Neon Valley', 'Family Table', 'Northbound', 'Glass Houses']
  : ['Yal', 'Tulsa King', 'High Potential', 'Time', 'Bamdad-e Khomar', 'Sorkh O Siah', 'Karagah Alavi', 'Ted Lasso', 'Matlock', 'Gulcemal'];
const CAST = SHOWCASE ? 'Ava Lindqvist, Omid Karimi, Leila Navid, Marcus Hale' : 'Kate Winslet, Liam Hemsworth, Hugo Weaving, Judy Davis';

const STREAMS = {
  live: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  movie: 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
  series: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
};

const now = Math.floor(Date.now() / 1000);
const pick = (list, i) => list[i % list.length];

const live = [];
LIVE_GROUPS.forEach((group, g) => {
  for (let i = 0; i < 24; i++) {
    const id = g * 100 + i + 1;
    live.push({ num: live.length + 1, name: (g < 3 && !SHOWCASE ? 'IR | ' : '') + pick(CHANNEL_NAMES, id), stream_id: id, stream_icon: '/demo/logo/' + id + '.svg', category_id: String(g + 1), is_adult: '0' });
  }
});
const movies = [];
VOD_GROUPS.forEach((group, g) => {
  for (let i = 0; i < (g === 0 ? 60 : 18); i++) {
    const id = 1000 + g * 100 + i;
    movies.push({ stream_id: id, name: pick(MOVIE_NAMES, id) + (i >= MOVIE_NAMES.length ? ' ' + (2000 + i) : ''), stream_icon: '/demo/poster/' + id + '.svg',
      rating: ((id * 37) % 50 / 10 + 5).toFixed(1), category_id: String(g + 1), added: String(now - i * 86400), container_extension: 'mp4', is_adult: '0' });
  }
});
const series = [];
SERIES_GROUPS.forEach((group, g) => {
  for (let i = 0; i < (g === 0 ? 40 : 12); i++) {
    const id = 5000 + g * 100 + i;
    series.push({ series_id: id, name: pick(SERIES_NAMES, id) + (i >= SERIES_NAMES.length ? ' ' + (i + 1) : ''), cover: '/demo/poster/' + id + '.svg',
      rating: ((id * 13) % 50 / 10 + 5).toFixed(1), category_id: String(g + 1), last_modified: String(now - i * 43200), cast: CAST });
  }
});

function svg(id, w, h, label) {
  const hue = (id * 47) % 360;
  const words = String(label).split(' ');
  const lines = [];
  words.forEach(word => {
    if (lines.length && (lines[lines.length - 1] + ' ' + word).length <= 12) lines[lines.length - 1] += ' ' + word;
    else lines.push(word);
  });
  const size = Math.round(w / 9);
  const text = lines.slice(0, 4).map((line, i) => '<text x="50%" y="' + (h / 2 + (i - (Math.min(lines.length, 4) - 1) / 2) * size * 1.2) +
    '" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="' + size + '" fill="#fff">' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="hsl(' + hue + ',70%,45%)"/><stop offset="1" stop-color="hsl(' + ((hue + 60) % 360) + ',70%,18%)"/></linearGradient></defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/>' + text + '</svg>';
}

function api(params) {
  const categories = names => names.map((name, i) => ({ category_id: String(i + 1), category_name: name, parent_id: 0 }));
  switch (params.get('action')) {
    case null:
      return { user_info: { auth: 1, status: 'Active', exp_date: String(now + 90 * 86400), max_connections: '1' }, server_info: {} };
    case 'get_live_categories': return categories(LIVE_GROUPS);
    case 'get_live_streams': return live;
    case 'get_vod_categories': return categories(VOD_GROUPS);
    case 'get_vod_streams': return movies;
    case 'get_series_categories': return categories(SERIES_GROUPS);
    case 'get_series': return series;
    case 'get_vod_info': {
      const m = movies.find(x => String(x.stream_id) === params.get('vod_id')) || movies[0];
      return { info: { name: m.name, movie_image: m.stream_icon, plot: 'A demo film for trying the interface.', cast: CAST, director: 'Jocelyn Moorhouse', releasedate: '2015-10-29', duration_secs: 7080, rating: m.rating, genre: 'Drama / Comedy' },
        movie_data: { stream_id: m.stream_id, container_extension: 'mp4' } };
    }
    case 'get_series_info': {
      const s = series.find(x => String(x.series_id) === params.get('series_id')) || series[0];
      const episodes = {};
      [1, 2].forEach(season => {
        episodes[season] = Array.from({ length: 8 }, (_, i) => ({ id: String(s.series_id * 100 + season * 10 + i), episode_num: i + 1, title: s.name + ' S0' + season + 'E0' + (i + 1),
          container_extension: 'mp4', info: { plot: 'Episode ' + (i + 1), duration_secs: 2700 } }));
      });
      return { info: { name: s.name, cover: s.cover, plot: 'A demo series.', cast: CAST, rating: s.rating }, seasons: [], episodes: episodes };
    }
    case 'get_short_epg': {
      // Every other channel has a guide.
      const id = Number(params.get('stream_id'));
      if (id % 2) return { epg_listings: [] };
      const t = Math.floor(Date.now() / 1000);
      const show = (title, start, stop) => ({ title: Buffer.from(title).toString('base64'), start_timestamp: String(start), stop_timestamp: String(stop) });
      return { epg_listings: [show(pick(['Evening News', 'Music Hour', 'Football: Live', 'Movie Night', 'Talk Show'], id), t - 1800, t + 1800), show('Late Show', t + 1800, t + 5400)] };
    }
  }
  return [];
}

// Returns true when the request was for the demo server.
module.exports = function handle(url, res) {
  if (!url.pathname.startsWith('/demo/')) return false;
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  let m;
  if (url.pathname === '/demo/player_api.php') send('application/json', JSON.stringify(api(url.searchParams)));
  else if ((m = /^\/demo\/poster\/(\d+)\.svg$/.exec(url.pathname))) {
    const id = Number(m[1]);
    const item = movies.find(x => x.stream_id === id) || series.find(x => x.series_id === id);
    send('image/svg+xml', svg(id, 400, 600, item ? item.name : id));
  } else if ((m = /^\/demo\/logo\/(\d+)\.svg$/.exec(url.pathname))) {
    const id = Number(m[1]);
    send('image/svg+xml', svg(id, 240, 160, pick(CHANNEL_NAMES, id).split(' ')[0]));
  } else if ((m = /^\/demo\/(live|movie|series)\//.exec(url.pathname))) {
    res.writeHead(302, { location: STREAMS[m[1]] });
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
  return true;
};
