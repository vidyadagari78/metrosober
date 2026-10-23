import crypto from 'crypto';
import http from 'http';
import https from 'https';

interface WebhookArgs {
  orderId: string;
  amountPaise?: number;
  eventId: string;
  status: string;
  apiUrl: string;
  secret: string;
}

function parseArgs(): WebhookArgs {
  const args = process.argv.slice(2);
  let orderId = '';
  let amountPaise: number | undefined;
  let eventId = `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  let status = 'captured';
  let apiUrl = process.env.API_URL || 'http://localhost:3000';
  let secret = process.env.WEBHOOK_SECRET || 'pickup_counter_super_secret_key_2026';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--order' || arg === '-o') {
      orderId = args[++i];
    } else if (arg === '--amount' || arg === '-a') {
      amountPaise = parseInt(args[++i], 10);
    } else if (arg === '--event' || arg === '-e') {
      eventId = args[++i];
    } else if (arg === '--status' || arg === '-s') {
      status = args[++i];
    } else if (arg === '--url' || arg === '-u') {
      apiUrl = args[++i];
    } else if (arg === '--secret') {
      secret = args[++i];
    } else if (!orderId && !arg.startsWith('-')) {
      orderId = arg;
    } else if (amountPaise === undefined && !arg.startsWith('-')) {
      amountPaise = parseInt(arg, 10);
    } else if (!arg.startsWith('-')) {
      eventId = arg;
    }
  }

  return { orderId, amountPaise, eventId, status, apiUrl, secret };
}

async function fetchOrderTotal(apiUrl: string, orderId: string): Promise<number> {
  const url = `${apiUrl}/orders/${orderId}`;
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              resolve(json.totalPaise);
            } catch (e) {
              reject(new Error(`Failed to parse order JSON: ${data}`));
            }
          } else {
            reject(new Error(`Order lookup failed with HTTP ${res.statusCode}: ${data}`));
          }
        });
      })
      .on('error', reject);
  });
}

async function sendWebhookRequest(urlStr: string, payloadStr: string, signature: string) {
  const url = new URL(urlStr);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
          'X-Signature': signature,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body,
          });
        });
      }
    );

    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
}

async function main() {
  const opts = parseArgs();

  if (!opts.orderId) {
    console.error(`
Usage:
  npm run send-webhook -- <orderId> [amountPaise] [eventId]
  
Options:
  --order, -o   Order UUID (required)
  --amount, -a  Amount in paise (optional, auto-fetched from order if omitted)
  --event, -e   Webhook Event ID (optional, default: evt_<timestamp>)
  --status, -s  Payment status (optional, default: captured)
  --url, -u     API base URL (default: http://localhost:3000)
  --secret      Webhook HMAC shared secret

Examples:
  npm run send-webhook -- 12345678-1234-1234-1234-123456789abc
  npm run send-webhook -- 12345678-1234-1234-1234-123456789abc 3500 evt_custom_99
`);
    process.exit(1);
  }

  // If amountPaise is omitted, fetch it automatically from the order
  let amount = opts.amountPaise;
  if (amount === undefined) {
    console.log(`Amount not specified. Fetching order ${opts.orderId} from ${opts.apiUrl}...`);
    try {
      amount = await fetchOrderTotal(opts.apiUrl, opts.orderId);
      console.log(`Fetched order total: ${amount} paise (₹${(amount / 100).toFixed(2)})`);
    } catch (err: any) {
      console.error(`Could not retrieve order details: ${err.message}`);
      console.error('Please specify amountPaise manually: npm run send-webhook -- <orderId> <amountPaise>');
      process.exit(1);
    }
  }

  const payloadObj = {
    eventId: opts.eventId,
    orderId: opts.orderId,
    amountPaise: amount,
    status: opts.status,
  };

  const payloadString = JSON.stringify(payloadObj);

  // Compute HMAC-SHA256 signature
  const hmac = crypto.createHmac('sha256', opts.secret);
  hmac.update(payloadString);
  const signature = hmac.digest('hex');

  const webhookEndpoint = `${opts.apiUrl}/payments/webhook`;

  console.log('\n================ PAYMENT WEBHOOK SIMULATOR ================');
  console.log(`Target URL : ${webhookEndpoint}`);
  console.log(`Payload    : ${payloadString}`);
  console.log(`Signature  : ${signature}`);
  console.log('------------------------------------------------------------');

  try {
    const response = await sendWebhookRequest(webhookEndpoint, payloadString, signature);
    console.log(`Response Status: HTTP ${response.statusCode}`);
    console.log(`Response Body  : ${response.body}`);
    console.log('============================================================\n');

    if (response.statusCode >= 200 && response.statusCode < 300) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Failed to send webhook: ${err.message}`);
    process.exit(1);
  }
}

main();
