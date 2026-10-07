/** Preserve only the validated consent route through email and Google login. */
export function oauthReturnPath(search: string): string {
  const value = new URLSearchParams(search).get('returnTo');
  if (!value) return '/home';
  try {
    const url = new URL(value, 'https://app.constil.com');
    const id = url.searchParams.get('authorization_id');
    if (url.origin !== 'https://app.constil.com' || url.pathname !== '/oauth/consent' || !id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return '/home';
    return '/oauth/consent?authorization_id=' + encodeURIComponent(id);
  } catch { return '/home'; }
}
