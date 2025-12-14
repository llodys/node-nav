# Node-Nav 导航站

- 本项目基于**老王 (eooce)** 的项目进行修改和完善，原作者仓库地址：https://github.com/eooce/nodejs-argo
- 一个基于 Node.js + Argo隧道 + 轻量级个人导航站，包含前台展示、后台登录管理、书签存储功能。
- 专为PaaS平台和游戏玩具平台设计,它支持多种代理协议（VLESS、VMess、Trojan等），并集成了哪吒探针功能。

---

## 🖼️ 项目预览

<div style="display: flex; justify-content: space-around; gap: 20px; padding: 10px;">
  <img src="https://raw.githubusercontent.com/llodys/node-nav/main/photo/nav.png" 
       width="45%" 
       style="border: 2px solid #ddd; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);"
       alt="项目主导航页面">
  <img src="https://raw.githubusercontent.com/llodys/node-nav/main/photo/nav.admin.png" 
       width="45%" 
       style="border: 2px solid #ddd; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);"
       alt="项目后台管理页面">
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
| `UUID` | `beaf3a9f-b586-4bf3-a570-3103a020d72b` | `建议修改` | 服务唯一标识 |
| `PORT` | `3000` | `3000` | 服务监听端口 |
| `ARGO_DOMAIN` | 空 | `建议修改` | Argo Tunnel 域名 |
| `ARGO_AUTH` | 空 | `建议修改` | Argo Tunnel 密钥 |
| `ARGO_PORT` | `8001` | `否` | Argo 监听端口 |
| `CFIP` | `cdns.doon.eu.org` | 否 | Cloudflare 优选 IP |
| `SUB_PATH` | `sub` | `建议修改` | 节点订阅路径 |
| `NAME` | `node` | `建议修改` | 节点名称前缀 |
| `NEZHA_SERVER` | 空 | `否` | 哪吒v1填写形式: nz.abc.com:8008;哪吒v0填写形式：nz.abc.com |
| `NEZHA_PORT` | 空 | `否` | 使用哪吒v1请留空，哪吒v0需填写 |
| `NEZHA_KEY` | 空 | `否` | 哪吒v1的NZ_CLIENT_SECRET;哪吒v0的agent密钥 |
| `ADMIN_PASSWORD` | `123456` | `建议修改` | 后台登录密码 |

容器平台 Docker 镜像：ghcr.io/llodys/node-nav:latest

---

## ⚡ 一键安装脚本（推荐）

本项目支持一键安装，自动完成依赖安装、环境配置、启动服务。

执行以下命令：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/llodys/node-nav/main/install.sh)
```

---

## 🙏 致谢

本项目基于**老王 (eooce)** 的项目进行修改和完善。

在此，对原作者 **老王** 表示由衷的感谢！

原作者仓库地址：https://github.com/eooce/nodejs-argo

---

## ⚠️ 免责声明

本项目仅供个人学习与研究使用，请勿将其用于任何违反当地法律法规的场景。  
使用本项目所产生的风险由使用者自行承担，与作者无关。  
如继续使用，即代表你已同意并接受本免责声明。
