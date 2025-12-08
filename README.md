# Node-Nav 导航站

一个基于 Node.js + Express 的轻量级个人导航站，包含前台展示、后台登录管理、书签存储功能。

---

## 🖼️ 项目预览

<div style="display: flex; gap: 10px;">
  <img src="https://raw.githubusercontent.com/llodys/node-nav/main/photo/nav.png" width="45%">
  <img src="https://raw.githubusercontent.com/llodys/node-nav/main/photo/nav.admin.png" width="45%">
</div>

---

## 🚀 功能

- 登录后台
- 书签增删改管理
- 前台展示导航列表
- 数据存储在 data/bookmark.json
- 自带 index、login、admin 三个页面
- 简单易部署

### 📌 各变量说明

| 变量名 | 默认值 | 必填 | 说明 |
|--------|--------|------|------|
| `UUID` | 空 | 否 | 服务唯一标识 |
| `PORT` | `3000` | 否 | 服务监听端口 |
| `ARGO_DOMAIN` | 空 | 否 | Argo Tunnel 域名 |
| `ARGO_AUTH` | 空 | 视情况 | Argo Tunnel 密钥 |
| `ARGO_PORT` | `8001` | 否 | Argo 监听端口 |
| `CFIP` | `cf.008500.xyz` | 否 | Cloudflare 优选 IP |
| `SUB_PATH` | `sub` | 否 | 节点订阅路径（如 `/sub/`） |
| `NAME` | `node` | 否 | 节点名称前缀 |
| `ADMIN_PASSWORD` | `123456` | 是（建议修改） | 后台登录密码 |

---

## ⚡ 一键安装脚本（推荐）

本项目支持一键安装，自动完成依赖安装、环境配置、启动服务。

执行以下命令：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/llodys/node-nav/main/install.sh)
```

---

## ⚠️ 免责声明

本项目仅供个人学习与研究使用，请勿将其用于任何违反当地法律法规的场景。  
使用本项目所产生的风险由使用者自行承担，与作者无关。  
如继续使用，即代表你已同意并接受本免责声明。
