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

// 环境变量配置
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址,需填写部署Merge-sub项目后的首页地址,例如：https://merge.xxx.com
const PROJECT_URL = process.env.PROJECT_URL || '';    // 需要上传订阅或保活时需填写项目分配的url,例如：https://google.com
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // false关闭自动保活，true开启,需同时填写PROJECT_URL变量
const FILE_PATH = process.env.FILE_PATH || './data';   // 运行目录,sub节点文件保存目录
const SUB_PATH = process.env.SUB_PATH || 'sub';       // 订阅路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        // http服务订阅端口
const UUID = process.env.UUID || ''; // 使用哪吒v1,在不同的平台运行需修改UUID,否则会覆盖
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        // 哪吒v1填写形式: nz.abc.com:8008  哪吒v0填写形式：nz.abc.com
const NEZHA_PORT = process.env.NEZHA_PORT || '';            // 使用哪吒v1请留空，哪吒v0需填写
const NEZHA_KEY = process.env.NEZHA_KEY || '';              // 哪吒v1的NZ_CLIENT_SECRET或哪吒v0的agent密钥
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          // 固定隧道域名,留空即启用临时隧道
const ARGO_AUTH = process.env.ARGO_AUTH || '';              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://json.zone.id
const ARGO_PORT = process.env.ARGO_PORT || 8001;            // 固定隧道端口,使用token需在cloudflare后台设置和这里一致
const CFIP = process.env.CFIP || 'cf.008500.xyz';        // 节点优选域名或优选ip  
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const NAME = process.env.NAME || '';                        // 节点名称
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";    // 书签后台管理密码：https://域名或IP:服务订阅端口/admin

const bookmarksPath = path.join(FILE_PATH, 'bookmarks.json');
const defaultBookmarks = {}; // 默认空书签

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= [系统监控逻辑] =================
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
    } catch (e) { /* Ignore */ }
}

setInterval(async () => {
    // 更新 CPU
    const currentCpuInfo = getCpuInfo();
    const totalDiff = currentCpuInfo.total - lastCpuInfo.total;
    const idleDiff = currentCpuInfo.idle - lastCpuInfo.idle;
    if (totalDiff > 0) systemStatus.cpu = ((1 - idleDiff / totalDiff) * 100).toFixed(0);
    lastCpuInfo = currentCpuInfo;

    // 更新内存
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    systemStatus.mem = (((totalMem - freeMem) / totalMem) * 100).toFixed(0);

    // 更新系统负载和时间
    systemStatus.uptime = os.uptime();
    systemStatus.load = os.loadavg()[0].toFixed(2);

    // 更新网络流量
    await updateNetStats();

    // 更新硬盘 (仅限 Linux)
    if (process.platform === 'linux') {
        try { 
            const { stdout } = await exec("df -h / | tail -1 | awk '{print $5}'"); 
            systemStatus.disk = parseInt(stdout.replace('%', '')) || 0; 
        } catch (err) {}
    }
}, 2000);

// 获取状态 API
app.get('/api/status', (req, res) => { res.json(systemStatus); });
// ================= [监控逻辑结束] =================


// 初始化运行目录
if (!fs.existsSync(FILE_PATH)) { fs.mkdirSync(FILE_PATH, { recursive: true }); console.log(`${FILE_PATH} is created`); } 
else { console.log(`${FILE_PATH} already exists`); }


// 1. 首页路由
app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.send("Welcome! Service is running. Please place index.html in the 'public' folder.");
});

// 2. 登录页路由 (新增)
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 3. 后台页路由
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 4. 密码验证接口
app.post("/check-password", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// 5. 获取书签接口
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

// 6. 保存书签接口
app.post('/api/bookmarks', (req, res) => {
  const { password, bookmarksData } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Invalid password.' });
  if (!bookmarksData) return res.status(400).json({ success: false, message: 'No data provided.' });

  fs.writeFile(bookmarksPath, JSON.stringify(bookmarksData, null, 2), 'utf8', (err) => {
    if (err) return res.status(500).json({ success: false, message: 'Failed to save bookmarks.' });
    res.json({ success: true, message: 'Bookmarks saved successfully.' });
  });
});


// ================= [核心业务逻辑] =================

function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;
    let fileContent;
    try { fileContent = fs.readFileSync(subPath, 'utf-8'); } catch { return null; }
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));
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
  filesToAuthorize.forEach(p => { if (fs.existsSync(p)) fs.chmod(p, 0o775, ()=>{}); });

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
    const m = execSync('curl -sm 5 https://speed.cloudflare.com/meta | awk -F\\" \'{print $26"-"$18}\' | sed -e \'s/ /_/g\'', { encoding: 'utf-8' });
    const n = NAME ? `${NAME}-${m.trim()}` : m.trim();
    return new Promise((r) => {
      setTimeout(() => {
        const v = { v: '2', ps: `${n}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: d, path: '/vmess-argo?ed=2560', tls: 'tls', sni: d, alpn: '', fp: 'firefox'};
        const s = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${d}&fp=firefox&type=ws&host=${d}&path=%2Fvless-argo%3Fed%3D2560#${n}\nvmess://${Buffer.from(JSON.stringify(v)).toString('base64')}\ntrojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${d}&fp=firefox&type=ws&host=${d}&path=%2Ftrojan-argo%3Fed%3D2560#${n}`;
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
    const n = c.split('\n').filter(l => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(l));
    if (n.length > 0) try { await axios.post(`${UPLOAD_URL}/api/add-nodes`, JSON.stringify({ nodes: n }), { headers: { 'Content-Type': 'application/json' } }); } catch (e) {}
  }
}

function cleanFiles() {
  setTimeout(() => {
    const f = [bootLogPath, configPath, webPath, botPath];  
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
  try { deleteNodes(); cleanupOldFiles(); await generateConfig(); await downloadFilesAndRun(); await extractDomains(); await AddVisitTask(); } catch (e) { console.error('Error in startserver:', e); }
}
startserver().catch(e => console.error('Unhandled error:', e));

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));