/**
 * Utilitários para geração de URLs M3U
 */

export interface M3UUrls {
  m3u_ts: string;
  m3u_hls: string;
  ssiptv: string;
  xciptv: {
    server: string;
    username: string;
    password: string;
  };
}

/**
 * Constrói URL M3U
 */
export function buildM3uUrl(
  dns: string,
  username: string,
  password: string,
  format: 'ts' | 'hls' = 'ts'
): string {
  const baseUrl = dns.replace(/\/$/, ''); // Remover / final
  const output = format === 'hls' ? 'hls' : 'mpegts';
  return `${baseUrl}/get.php?username=${username}&password=${password}&type=m3u_plus&output=${output}`;
}

/**
 * Constrói todas as variantes de URLs M3U
 */
export function buildM3uUrls(dns: string, username: string, password: string): M3UUrls {
  const base = dns.replace(/\/$/, '');
  
  return {
    m3u_ts: `${base}/get.php?username=${username}&password=${password}&type=m3u_plus&output=mpegts`,
    m3u_hls: `${base}/get.php?username=${username}&password=${password}&type=m3u_plus&output=hls`,
    ssiptv: `${base}/get.php?username=${username}&password=${password}&type=m3u&output=mpegts`,
    // Para apps como XCIPTV:
    xciptv: {
      server: base,
      username,
      password,
    }
  };
}

