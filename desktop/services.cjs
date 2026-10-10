const services = {
  spotify: { title: 'Spotify', home: 'https://open.spotify.com', protocol: 'spotify:' },
  youtube: { title: 'YouTube', home: 'https://www.youtube.com' },
  google: { title: 'Google', home: 'https://www.google.com' },
};
function serviceTarget(service, query = '') {
  if (!Object.hasOwn(services, service)) throw new Error('Unsupported search service.');
  if (typeof query !== 'string' || query.length > 500 || /[\u0000-\u001f]/.test(query))
    throw new Error('Keep the search below 500 characters.');
  query = query.trim();
  const config = services[service];
  const url = new URL(config.home);
  if (query) {
    if (service === 'spotify') url.pathname = '/search/' + encodeURIComponent(query);
    else if (service === 'youtube') {
      url.pathname = '/results';
      url.searchParams.set('search_query', query);
    } else {
      url.pathname = '/search';
      url.searchParams.set('q', query);
    }
  }
  return {
    title: config.title,
    web: url.href,
    native: service === 'spotify' ? (query ? 'spotify:search:' + encodeURIComponent(query) : 'spotify:') : null,
  };
}
async function openService(intent, { hasProtocol, openExternal }) {
  const target = serviceTarget(intent.service, intent.query);
  if (target.native) {
    try {
      if (await hasProtocol(target.native)) {
        await openExternal(target.native);
        return { message: 'Opened ' + target.title + (intent.query ? ' search in the app' : ' app') };
      }
    } catch { /* Missing or broken protocol handlers fall back to the web player. */ }
  }
  await openExternal(target.web);
  return { message: 'Opened ' + target.title + (intent.query ? ' search on the web' : ' on the web') };
}
module.exports = { services, serviceTarget, openService };
