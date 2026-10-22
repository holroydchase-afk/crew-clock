import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { env } from './http.ts';

// Backblaze B2 through its S3-compatible API. The bucket stays private; phones get
// a link that works for 10 minutes for one upload or one view.
function client() {
  return new AwsClient({
    accessKeyId: env('B2_KEY_ID'),
    secretAccessKey: env('B2_APPLICATION_KEY'),
    service: 's3',
    region: env('B2_REGION'), // e.g. us-east-005
  });
}

function objectUrl(key: string) {
  return `https://s3.${env('B2_REGION')}.backblazeb2.com/${env('B2_BUCKET')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function presign(method: 'PUT' | 'GET', key: string, seconds = 600) {
  const req = await client().sign(`${objectUrl(key)}?X-Amz-Expires=${seconds}`, {
    method,
    aws: { signQuery: true },
    headers: method === 'PUT' ? { 'Content-Type': 'image/jpeg' } : {},
  });
  return req.url;
}
