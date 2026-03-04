const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

const UPLOAD_URL = process.env.UPLOAD_URL || '';            // 订阅节点自动上传的外部 API 地址（选填，用于统一管理多台机器的节点）
const PROJECT_URL = process.env.PROJECT_URL || '';          // 当前项目运行的公网 URL，用于保活任务或拼接订阅路径（选填）
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;       // 是否开启自带的访问保活任务（true/false），防止云平台休眠
const FILE_PATH = process.env.FILE_PATH || './data';        // 核心运行文件和配置文件的临时存放目录，通常不需要改
const SUB_PATH = process.env.SUB_PATH || 'sub';             // 订阅链接的路径，例如填 'sub'，你的订阅地址就是 域名/sub
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;  // Web 伪装服务和内部主代理监听的本地端口
const UUID = process.env.UUID || 'beaf3a9f-b586-4bf3-a570-3103a020d72b'; // 核心用户的 UUID，也是绝大多数协议默认的连接密码
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        // 哪吒探针的服务端地址（选填，例如：nezha.example.com:5555）
const NEZHA_PORT = process.env.NEZHA_PORT || '';            // 哪吒探针的服务端端口（选填，配合上面的地址使用）
const NEZHA_KEY = process.env.NEZHA_KEY || '';              // 哪吒探针的客户端授权密钥（选填）
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          // Cloudflare Argo 隧道的固定域名（选填，不填则自动抓取临时域名）
const ARGO_AUTH = process.env.ARGO_AUTH || '';              // Cloudflare Argo 隧道的 Token 或 TunnelSecret（选填）
const ARGO_PORT = process.env.ARGO_PORT || 8001;            // Argo 隧道在本地转发的目标端口，一般不用改
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';        // Cloudflare 优选 IP 或域名，用于生成节点订阅链接时提高速度
const CFPORT = process.env.CFPORT || 443;                   // Cloudflare 优选 IP 对应的端口，一般配合 TLS 使用 443
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";  // Web 伪装页面（书签管理页面）的管理员登录密码

const HY2_PORT = process.env.HY2_PORT || '';                // Hysteria2 协议监听的 UDP 端口（留空即代表不启动该协议）
const HY2_PASSWORD = process.env.HY2_PASSWORD || UUID;      // Hysteria2 的连接密码，如果不填则默认使用上面的 UUID

const SOCKS_PORT = process.env.SOCKS_PORT || '';            // SOCKS5 代理监听的 TCP 端口（留空即代表不启动）
const SOCKS_USER = process.env.SOCKS_USER || 'admin';       // SOCKS5 代理的认证用户名
const SOCKS_PASS = process.env.SOCKS_PASS || UUID;          // SOCKS5 代理的认证密码，如果不填则默认使用上面的 UUID

const TUIC_PORT = process.env.TUIC_PORT || '';              // TUIC 协议监听的 UDP 端口（留空即代表不启动）
const TUIC_PASSWORD = process.env.TUIC_PASSWORD || UUID;    // TUIC 的连接密码，如果不填则默认使用上面的 UUID

const ANYTLS_PORT = process.env.ANYTLS_PORT || '';          // AnyTLS 协议监听的 TCP 端口（留空即代表不启动）
const ANYTLS_PASSWORD = process.env.ANYTLS_PASSWORD || UUID; // AnyTLS 的连接密码，如果不填则默认使用上面的 UUID

const REALITY_PORT = process.env.REALITY_PORT || '';        // VLESS-Reality 协议监听的 TCP 端口（留空即代表不启动）
const REALITY_PRIVATE_KEY = process.env.REALITY_PRIVATE_KEY || ''; // Reality 的 x25519 私钥（仅留在服务端解密使用）
const REALITY_PUBLIC_KEY = process.env.REALITY_PUBLIC_KEY || '';   // Reality 的 x25519 公钥（用于拼接在客户端的订阅节点中）
const REALITY_SHORTID = process.env.REALITY_SHORTID || '';         // Reality 的 ShortId (短 ID)，额外的连接验证码（最长16位十六进制）
const REALITY_DEST = process.env.REALITY_DEST || 'www.microsoft.com:443'; // Reality 伪装转发的真实目标网站
const REALITY_SERVER_NAMES = process.env.REALITY_SERVER_NAMES || 'www.microsoft.com'; // Reality 伪装目标网站的 SNI，必须与 DEST 匹配

const bookmarksPath = path.join(FILE_PATH, 'bookmarks.json');
const defaultBookmarks = {}; 

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let systemStatus = { cpu: 0, mem: 0, disk: 0, uptime: 0, load: 0, netIn: 0, netOut: 0 };

function getCpuInfo() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (let cpu of cpus) { user += cpu.times.user; nice += cpu.times.nice; sys += cpu.times.sys; idle += cpu.times.idle; irq += cpu.times.irq; }
    return { idle, total: user + nice + sys + idle + irq };
}

let lastCpuInfo = getCpuInfo();
let lastNetStat = { rx: 0, tx: 0, time: Date.now() };

async function updateNetStats() {
    try {
        if (process.platform !== 'linux') return;
        const data = await fs.promises.readFile('/proc/net/dev', 'utf8');
        const lines = data.split('\n');
        let rx = 0, tx = 0;
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = line.split(/\s+/);
            if (parts.length >= 10) {
                const rxVal = parseInt(parts[0].includes(':') ? parts[1] : parts[1]);
                const txVal = parseInt(parts[0].includes(':') ? parts[9] : parts[9]); 
                if (!isNaN(rxVal)) rx += rxVal;
                if (!isNaN(txVal)) tx += txVal;
            }
        }
        const now = Date.now();
        const duration = (now - lastNetStat.time) / 1000; 
        if (duration > 0 && lastNetStat.rx > 0) {
            systemStatus.netIn = ((rx - lastNetStat.rx) / duration).toFixed(0);
            systemStatus.netOut = ((tx - lastNetStat.tx) / duration).toFixed(0);
        }
        lastNetStat = { rx, tx, time: now };
    } catch (e) {}
}

setInterval(async () => {
    const currentCpuInfo = getCpuInfo();
    const totalDiff = currentCpuInfo.total - lastCpuInfo.total;
    const idleDiff = currentCpuInfo.idle - lastCpuInfo.idle;
    if (totalDiff > 0) systemStatus.cpu = ((1 - idleDiff / totalDiff) * 100).toFixed(0);
    lastCpuInfo = currentCpuInfo;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    systemStatus.mem = (((totalMem - freeMem) / totalMem) * 100).toFixed(0);

    systemStatus.uptime = os.uptime();
    systemStatus.load = os.loadavg()[0].toFixed(2);

    await updateNetStats();

    if (process.platform === 'linux') {
        try { 
            const { stdout } = await exec("df -h / | tail -1 | awk '{print $5}'"); 
            systemStatus.disk = parseInt(stdout.replace('%', '')) || 0; 
        } catch (err) {}
    }
}, 2000);

app.get('/api/status', (req, res) => { res.json(systemStatus); });

if (!fs.existsSync(FILE_PATH)) { fs.mkdirSync(FILE_PATH, { recursive: true }); console.log(`${FILE_PATH} is created`); } 
else { console.log(`${FILE_PATH} already exists`); }

app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.send("Welcome! Service is running. Please place index.html in the 'public' folder.");
});

app.get("/login", (req, res) => { res.sendFile(path.join(__dirname, 'public', 'login.html')); });
app.get("/admin", (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

app.post("/check-password", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) res.json({ success: true });
  else res.json({ success: false });
});

app.get('/api/bookmarks', (req, res) => {
  if (fs.existsSync(bookmarksPath)) {
    fs.readFile(bookmarksPath, 'utf8', (err, data) => {
      if (err) return res.status(500).json({ error: 'Failed to read bookmarks file.' });
      try { res.json(JSON.parse(data)); } catch (parseErr) { res.status(500).json({ error: 'Failed to parse bookmarks file.' }); }
    });
  } else {
    fs.writeFile(bookmarksPath, JSON.stringify(defaultBookmarks, null, 2), 'utf8', (err) => {
      if (err) return res.status(500).json({ error: 'Failed to create bookmarks file.' });
      res.json(defaultBookmarks);
    });
  }
});

app.post('/api/bookmarks', (req, res) => {
  const { password, bookmarksData } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Invalid password.' });
  if (!bookmarksData) return res.status(400).json({ success: false, message: 'No data provided.' });

  fs.writeFile(bookmarksPath, JSON.stringify(bookmarksData, null, 2), 'utf8', (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Failed to save bookmarks.' });
    res.json({ success: true, message: 'Bookmarks saved successfully.' });
  });
});

function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 文件路径生成
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
const hy2Name = generateRandomName(); 
const tuicName = generateRandomName();
const anytlsName = generateRandomName();

let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

let hy2Path = path.join(FILE_PATH, hy2Name);
let hy2ConfigPath = path.join(FILE_PATH, 'hy2_config.json');

let tuicPath = path.join(FILE_PATH, tuicName);
let tuicConfigPath = path.join(FILE_PATH, 'tuic_config.json');

let anytlsPath = path.join(FILE_PATH, anytlsName);

let certPath = path.join(FILE_PATH, 'server.crt');
let keyPath = path.join(FILE_PATH, 'server.key');

function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;
    let fileContent;
    try { fileContent = fs.readFileSync(subPath, 'utf-8'); } catch { return null; }
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic|anytls|socks):\/\//.test(line));
    if (nodes.length === 0) return;
    axios.post(`${UPLOAD_URL}/api/delete-nodes`, JSON.stringify({ nodes }), { headers: { 'Content-Type': 'application/json' } }).catch((error) => { return null; });
    return null;
  } catch (err) { return null; }
}

function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && path.basename(filePath) !== 'bookmarks.json') {
          fs.unlinkSync(filePath);
        }
      } catch (err) {}
    });
  } catch (err) {}
}

async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };

  if (SOCKS_PORT) {
    config.inbounds.push({
      port: parseInt(SOCKS_PORT),
      listen: "0.0.0.0", 
      protocol: "socks",
      settings: { auth: "password", accounts: [{ user: SOCKS_USER, pass: SOCKS_PASS }], udp: true }
    });
  }

  // 注入 VLESS-Reality 节点
  if (REALITY_PORT && REALITY_PRIVATE_KEY && REALITY_PUBLIC_KEY && REALITY_SHORTID) {
    config.inbounds.push({
      port: parseInt(REALITY_PORT),
      listen: "0.0.0.0",
      protocol: "vless",
      settings: {
        clients: [{ id: UUID, flow: "xtls-rprx-vision" }],
        decryption: "none"
      },
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: {
          show: false,
          dest: REALITY_DEST,
          xver: 0,
          serverNames: REALITY_SERVER_NAMES.split(','),
          privateKey: REALITY_PRIVATE_KEY,
          shortIds: [REALITY_SHORTID]
        }
      }
    });
  }

  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') { return 'arm'; } else { return 'amd'; }
}

function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName; 
  if (!fs.existsSync(FILE_PATH)) { fs.mkdirSync(FILE_PATH, { recursive: true }); }
  const writer = fs.createWriteStream(filePath);
  axios({ method: 'get', url: fileUrl, responseType: 'stream', })
    .then(response => {
      response.data.pipe(writer);
      writer.on('finish', () => { writer.close(); console.log(`Download ${path.basename(filePath)} successfully`); callback(null, filePath); });
      writer.on('error', err => { fs.unlink(filePath, () => { }); console.error(`Download ${path.basename(filePath)} failed: ${err.message}`); callback(err.message); });
    })
    .catch(err => { console.error(`Download ${path.basename(filePath)} failed: ${err.message}`); callback(err.message); });
}

async function downloadFilesAndRun() {  
  const architecture = getSystemArchitecture();
  const filesToDownload = (architecture === 'arm') ? 
    [{ fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }] : 
    [{ fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }];

  if (HY2_PORT) {
    const hy2Url = architecture === 'arm' ? 
      "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-arm64" : 
      "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-amd64";
    filesToDownload.push({ fileName: hy2Path, fileUrl: hy2Url });
  }

  if (TUIC_PORT) {
    const tuicUrl = architecture === 'arm' ? 
      "https://github.com/EAimTY/tuic/releases/download/tuic-server-1.0.0/tuic-server-1.0.0-aarch64-unknown-linux-musl" : 
      "https://github.com/EAimTY/tuic/releases/download/tuic-server-1.0.0/tuic-server-1.0.0-x86_64-unknown-linux-musl";
    filesToDownload.push({ fileName: tuicPath, fileUrl: tuicUrl });
  }

  if (ANYTLS_PORT) {
    const anytlsUrl = architecture === 'arm' ? 
      "https://github.com/jxo-me/anytls-rs/releases/latest/download/anytls-rs-aarch64-unknown-linux-musl" : 
      "https://github.com/jxo-me/anytls-rs/releases/latest/download/anytls-rs-x86_64-unknown-linux-musl";
    filesToDownload.push({ fileName: anytlsPath, fileUrl: anytlsUrl });
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      filesToDownload.unshift({ fileName: npmPath, fileUrl: architecture === 'arm' ? "https://arm64.ssss.nyc.mn/agent" : "https://amd64.ssss.nyc.mn/agent" });
    } else {
      filesToDownload.unshift({ fileName: phpPath, fileUrl: architecture === 'arm' ? "https://arm64.ssss.nyc.mn/v1" : "https://amd64.ssss.nyc.mn/v1" });
    }
  }

  try {
    await Promise.all(filesToDownload.map(fileInfo => new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => { if (err) reject(err); else resolve(filePath); });
    })));
  } catch (err) { console.error('Error downloading files:', err); return; }
  
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  if (HY2_PORT) filesToAuthorize.push(hy2Path);
  if (TUIC_PORT) filesToAuthorize.push(tuicPath);
  if (ANYTLS_PORT) filesToAuthorize.push(anytlsPath);
  filesToAuthorize.forEach(p => { if (fs.existsSync(p)) fs.chmod(p, 0o775, ()=>{}); });

  // 共享生成自签证书
  if ((HY2_PORT || TUIC_PORT || ANYTLS_PORT) && !fs.existsSync(certPath)) {
    try {
      await exec(`openssl req -x509 -nodes -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 3650 -subj "/CN=bing.com"`);
    } catch (e) { console.error("Certificate generation failed:", e.message); }
  }

  if (HY2_PORT) {
    try {
      const hy2Config = {
        listen: `:${HY2_PORT}`,
        tls: { cert: certPath, key: keyPath },
        auth: { type: "password", password: HY2_PASSWORD },
        masquerade: { type: "proxy", proxy: { url: "https://bing.com", rewriteHost: true } }
      };
      fs.writeFileSync(hy2ConfigPath, JSON.stringify(hy2Config, null, 2));
      await exec(`nohup ${hy2Path} server -c ${hy2ConfigPath} >/dev/null 2>&1 &`);
      console.log(`Hysteria2 started on UDP port ${HY2_PORT}`);
    } catch (e) { console.error(e.message); }
  }

  if (TUIC_PORT) {
    try {
      const tuicConfig = {
        server: `[::]:${TUIC_PORT}`,
        users: { [UUID]: TUIC_PASSWORD },
        certificate: certPath,
        private_key: keyPath,
        congestion_control: "bbr",
        alpn: ["h3", "spdy/3.1"],
        udp_relay_ipv6: true
      };
      fs.writeFileSync(tuicConfigPath, JSON.stringify(tuicConfig, null, 2));
      await exec(`nohup ${tuicPath} -c ${tuicConfigPath} >/dev/null 2>&1 &`);
      console.log(`TUIC started on UDP port ${TUIC_PORT}`);
    } catch (e) { console.error(e.message); }
  }

  if (ANYTLS_PORT) {
    try {
      await exec(`nohup ${anytlsPath} -l 0.0.0.0:${ANYTLS_PORT} -p ${ANYTLS_PASSWORD} --cert ${certPath} --key ${keyPath} >/dev/null 2>&1 &`);
      console.log(`AnyTLS started on TCP port ${ANYTLS_PORT}`);
    } catch (e) { console.error(e.message); }
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tls = new Set(['443', '8443', '2096', '2087', '2083', '2053']).has(port) ? 'true' : 'false';
      const configYaml = `client_secret: ${NEZHA_KEY}\ndebug: false\ndisable_auto_update: true\ndisable_command_execute: false\ndisable_force_update: true\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: true\nip_report_period: 1800\nreport_delay: 4\nserver: ${NEZHA_SERVER}\nskip_connection_count: true\nskip_procs_count: true\ntemperature: false\ntls: ${tls}\nuse_gitee_to_upgrade: false\nuse_ipv6_country_code: false\nuuid: ${UUID}`;
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
      try { await exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`); await new Promise((r) => setTimeout(r, 1000)); } catch (e) {}
    } else {
      let tls = ['443', '8443', '2096', '2087', '2083', '2053'].includes(NEZHA_PORT) ? '--tls' : '';
      try { await exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${tls} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`); await new Promise((r) => setTimeout(r, 1000)); } catch (e) {}
    }
  }
  
  try { await exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`); await new Promise((r) => setTimeout(r, 1000)); } catch (e) {}

  if (fs.existsSync(botPath)) {
    let args;
    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    else if (ARGO_AUTH.match(/TunnelSecret/)) args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    else args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    try { await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`); await new Promise((r) => setTimeout(r, 2000)); } catch (e) {}
  }
  await new Promise((r) => setTimeout(r, 5000));
}

function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) return;
  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const y = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\nprotocol: http2\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://localhost:${ARGO_PORT}\n    originRequest:\n      noTLSVerify: true\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), y);
  }
}
argoType();

async function extractDomains() {
  let d;
  if (ARGO_AUTH && ARGO_DOMAIN) { d = ARGO_DOMAIN; await generateLinks(d); } 
  else {
    try {
      const c = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const lines = c.split('\n');
      const ds = [];
      lines.forEach((line) => { const m = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/); if (m) ds.push(m[1]); });
      if (ds.length > 0) { d = ds[0]; await generateLinks(d); } 
      else {
        try { fs.unlinkSync(path.join(FILE_PATH, 'boot.log')); } catch(e){}
        try { if (process.platform === 'win32') await exec(`taskkill /f /im ${botName}.exe > nul 2>&1`); else await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`); } catch (e) {}
        await new Promise((r) => setTimeout(r, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        try { await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`); await new Promise((r) => setTimeout(r, 3000)); await extractDomains(); } catch (e) {}
      }
    } catch (e) {}
  }

  async function generateLinks(d) {
    let cityName = 'UnknownCity';
    let countryCode = 'UN'; 
    
    // 获取英文国家代码缩写和城市名称
    try {
      const geoRes = await axios.get('http://ip-api.com/json/?lang=en', { timeout: 3000 });
      if (geoRes.data && geoRes.data.status === 'success') {
        countryCode = geoRes.data.countryCode; 
        cityName = geoRes.data.city;           
      }
    } catch (e) {
      console.log('Failed to fetch geolocation');
    }

    // 新增：如果环境变量设置了 NAME，则使用它替换城市名称
    if (process.env.NAME) {
      cityName = process.env.NAME;
    }

    // 核心前缀：国家缩写-城市名称或环境变量 (注意这里从 _ 改成了 - )
    const nodePrefix = `${countryCode}-${cityName}`;

    let serverIP = CFIP; 
    if (HY2_PORT || SOCKS_PORT || REALITY_PORT || TUIC_PORT || ANYTLS_PORT) {
      try {
        const ipRes = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
        if (ipRes.data.ip) serverIP = ipRes.data.ip;
      } catch (e) {
        console.log('Failed to fetch public IP, fallback to CFIP');
      }
    }

    // 以下为去掉协议后缀的节点拼接逻辑
    let hy2Link = '';
    if (HY2_PORT) {
      hy2Link = `\nhysteria2://${HY2_PASSWORD}@${serverIP}:${HY2_PORT}/?insecure=1&sni=bing.com#${nodePrefix}`;
    }

    let realityLink = '';
    if (REALITY_PORT && REALITY_PUBLIC_KEY && REALITY_SHORTID) {
      const sni = REALITY_SERVER_NAMES.split(',')[0];
      realityLink = `\nvless://${UUID}@${serverIP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${sni}&fp=chrome&pbk=${REALITY_PUBLIC_KEY}&sid=${REALITY_SHORTID}&type=tcp&headerType=none#${nodePrefix}`;
    }

    let tuicLink = '';
    if (TUIC_PORT) {
      tuicLink = `\ntuic://${UUID}:${TUIC_PASSWORD}@${serverIP}:${TUIC_PORT}/?sni=bing.com&congestion_control=bbr&udp_relay_mode=native&alpn=h3&allow_insecure=1#${nodePrefix}`;
    }

    let anytlsLink = '';
    if (ANYTLS_PORT) {
      anytlsLink = `\nanytls://${ANYTLS_PASSWORD}@${serverIP}:${ANYTLS_PORT}/?sni=bing.com&allow_insecure=1#${nodePrefix}`;
    }

    let socksLink = '';
    if (SOCKS_PORT) {
      const credentials = Buffer.from(`${SOCKS_USER}:${SOCKS_PASS}`).toString('base64');
      socksLink = `\nsocks://${credentials}@${serverIP}:${SOCKS_PORT}#${nodePrefix}`;
    }

    return new Promise((r) => {
      setTimeout(() => {
        const v = { v: '2', ps: `${nodePrefix}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: d, path: '/vmess-argo?ed=2560', tls: 'tls', sni: d, alpn: '', fp: 'firefox'};
        
        const vlessLink = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${d}&fp=firefox&type=ws&host=${d}&path=%2Fvless-argo%3Fed%3D2560#${nodePrefix}`;
        const vmessLink = `vmess://${Buffer.from(JSON.stringify(v)).toString('base64')}`;
        const trojanLink = `trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${d}&fp=firefox&type=ws&host=${d}&path=%2Ftrojan-argo%3Fed%3D2560#${nodePrefix}`;
        
        const s = `${vlessLink}\n${vmessLink}\n${trojanLink}${hy2Link}${realityLink}${tuicLink}${anytlsLink}${socksLink}`;
        
        fs.writeFileSync(subPath, Buffer.from(s).toString('base64'));
        uploadNodes();
        app.get(`/${SUB_PATH}`, (req, res) => { res.set('Content-Type', 'text/plain; charset=utf-8'); res.send(Buffer.from(s).toString('base64')); });
        r(s);
      }, 2000);
    });
  }
}

async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    try { await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [`${PROJECT_URL}/${SUB_PATH}`] }, { headers: { 'Content-Type': 'application/json' } }); } catch (e) {}
  } else if (UPLOAD_URL) {
    if (!fs.existsSync(listPath)) return;
    const c = fs.readFileSync(listPath, 'utf-8');
    const n = c.split('\n').filter(l => /(vless|vmess|trojan|hysteria2|tuic|anytls|socks):\/\//.test(l));
    if (n.length > 0) try { await axios.post(`${UPLOAD_URL}/api/add-nodes`, JSON.stringify({ nodes: n }), { headers: { 'Content-Type': 'application/json' } }); } catch (e) {}
  }
}

function cleanFiles() {
  setTimeout(() => {
    const f = [bootLogPath, configPath, webPath, botPath];  
    if (HY2_PORT) f.push(hy2Path, hy2ConfigPath, certPath, keyPath);
    if (TUIC_PORT) f.push(tuicPath, tuicConfigPath);
    if (ANYTLS_PORT) f.push(anytlsPath);
    if (NEZHA_PORT) f.push(npmPath); else if (NEZHA_SERVER && NEZHA_KEY) f.push(phpPath);
    const c = process.platform === 'win32' ? `del /f /q ${f.join(' ')} > nul 2>&1` : `rm -rf ${f.join(' ')} >/dev/null 2>&1`;
    exec(c, ()=>{ console.log('App is running'); });
  }, 90000);
}
cleanFiles();

async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) return;
  try { await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }, { headers: { 'Content-Type': 'application/json' } }); } catch (e) {}
}

async function startserver() {
  try { deleteNodes(); cleanupOldFiles(); await generateConfig(); await downloadFilesAndRun(); await extractDomains(); await AddVisitTask(); } catch (e) { console.error(e); }
}
startserver().catch(e => console.error(e));

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
