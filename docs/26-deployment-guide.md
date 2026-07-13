# JobLens 线上部署指南

本文档详细指导如何将 JobLens 服务部署上线，分为 **零服务器部署**（免费/低成本）和 **传统服务器部署**（需要购买云服务器）两种方案。

---

## 方案一：零服务器部署（推荐小白使用）⭐

使用 **Vercel**（前端托管）+ **Render**（后端托管）的组合，无需购买服务器，适合个人开发者和小流量场景。

### 前置准备

1. **GitHub 账号**：确保代码已推送到 GitHub 仓库
2. **AI API Key**：参考 [25-ai-provider-api-key-guide.md](25-ai-provider-api-key-guide.md) 获取 SiliconFlow 或 QwenCloud 的 API Key

### 步骤 1：部署前端到 Vercel

Vercel 是一个专为前端项目设计的托管平台，免费版足以支持小型项目。

1. **注册登录 Vercel**
   - 访问 https://vercel.com/
   - 使用 GitHub 账号登录（方便自动拉取代码）

2. **创建新项目**
   - 点击首页的 **Add New Project**
   - 在 Import Git Repository 中搜索你的 GitHub 仓库（如 `joblens-miniapp-project`）
   - 点击 **Import**

3. **配置项目**
   - **Framework Preset**：选择 `React`
   - **Build Command**：输入 `cd web-h5 && npm install && npm run build`
   - **Output Directory**：输入 `web-h5/dist`
   - 点击 **Deploy**

4. **等待部署完成**
   - Vercel 会自动构建并部署
   - 部署完成后会显示一个域名（如 `https://joblens-miniapp-project.vercel.app`）
   - 记下这个域名，后面会用到

### 步骤 2：部署后端到 Render

Render 提供免费的 Node.js 后端托管服务，适合小型 API 服务。

1. **注册登录 Render**
   - 访问 https://render.com/
   - 使用 GitHub 账号登录

2. **创建 Web Service**
   - 点击左侧菜单的 **New** → 选择 **Web Service**
   - 选择你的 GitHub 仓库

3. **配置服务**
   - **Name**：输入服务名称（如 `joblens-backend`）
   - **Region**：选择离你最近的地区（如 `Frankfurt`）
   - **Branch**：选择 `main`
   - **Root Directory**：输入 `backend`
   - **Build Command**：输入 `npm install && npm run build`
   - **Start Command**：输入 `npm start`

4. **添加环境变量**
   - 点击 **Advanced** → **Add Environment Variable**
   - 添加以下变量：
     - `AI_PROVIDER` = `siliconflow`（或 `qwencloud`、`rule-based`）
     - `SILICONFLOW_API_KEY` = 你的 SiliconFlow API Key
     - `QWENCLOUD_API_KEY` = 你的 QwenCloud API Key（可选）
     - `PORT` = `10000`（Render 要求）
     - `NODE_ENV` = `production`

5. **部署服务**
   - 点击 **Create Web Service**
   - 等待部署完成
   - 部署完成后会显示后端服务域名（如 `https://joblens-backend.onrender.com`）

### 步骤 3：配置前端 API 地址

现在需要让前端知道后端 API 的地址。

1. **回到 Vercel 项目**
   - 在 Vercel 中找到你的前端项目
   - 点击 **Settings** → **Environment Variables**

2. **添加环境变量**
   - 添加变量：`VITE_API_BASE_URL` = `https://你的后端域名/api`
   - 例如：`https://joblens-backend.onrender.com/api`

3. **重新部署前端**
   - 点击 **Deployments** → **Redeploy**
   - 确保环境变量生效

### 步骤 4：测试服务

1. 打开前端域名（如 `https://joblens-miniapp-project.vercel.app`）
2. 输入一段岗位 JD 文本
3. 点击检测，应该能看到风险报告

### 零服务器部署注意事项

- **免费额度限制**：
  - Vercel：每月 100GB 带宽，足够个人使用
  - Render：免费版服务有休眠机制（15分钟无请求会自动休眠，下次请求需要等待约10秒启动）
- **AI 费用**：SiliconFlow 和 QwenCloud 的 API 调用是付费的，记得充值
- **数据库**：当前项目使用内存存储，重启后数据会丢失。如需持久化存储，需要在 Render 上添加 PostgreSQL 数据库

---

## 方案二：传统服务器部署（需要购买服务器）

如果你有自己的云服务器，可以使用 Docker 或直接部署。

### 准备服务器

1. **购买云服务器**
   - 推荐阿里云、腾讯云、华为云
   - 最低配置：1核2G，带宽 1M 即可
   - 操作系统选择 Ubuntu 22.04

2. **登录服务器**
   - 使用 SSH 登录：`ssh root@你的服务器IP`

3. **安装必要软件**
   ```bash
   # 更新系统
   sudo apt update && sudo apt upgrade -y

   # 安装 Node.js 20
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # 安装 PostgreSQL（可选）
   sudo apt install -y postgresql postgresql-contrib

   # 安装 Redis（可选）
   sudo apt install -y redis-server
   ```

### 部署后端

1. **克隆代码**
   ```bash
   git clone https://github.com/KeithYww/joblens-miniapp-project.git
   cd joblens-miniapp-project/backend
   ```

2. **安装依赖**
   ```bash
   npm install
   npm run build
   ```

3. **配置环境变量**
   ```bash
   # 创建 .env 文件
   nano .env
   ```

   添加以下内容：
   ```bash
   PORT=3000
   NODE_ENV=production
   AI_PROVIDER=siliconflow
   SILICONFLOW_API_KEY=你的API密钥
   QWENCLOUD_API_KEY=你的API密钥（可选）
   ```

4. **启动服务（使用 PM2）**
   ```bash
   # 安装 PM2
   npm install -g pm2

   # 启动服务
   pm2 start dist/index.js --name joblens-backend

   # 设置开机自启
   pm2 startup
   pm2 save
   ```

### 部署前端

1. **进入前端目录**
   ```bash
   cd ../web-h5
   ```

2. **配置 API 地址**
   ```bash
   nano .env.production
   ```

   添加：
   ```bash
   VITE_API_BASE_URL=https://你的服务器IP/api
   ```

3. **构建前端**
   ```bash
   npm install
   npm run build
   ```

4. **配置 Nginx**
   ```bash
   # 安装 Nginx
   sudo apt install -y nginx

   # 复制构建产物到 Nginx 目录
   sudo cp -r dist/* /var/www/html/

   # 配置反向代理
   sudo nano /etc/nginx/sites-available/default
   ```

   修改配置：
   ```nginx
   server {
       listen 80;
       server_name 你的域名或IP;

       # 前端静态文件
       location / {
           root /var/www/html;
           try_files $uri $uri/ /index.html;
       }

       # 后端 API 代理
       location /api/ {
           proxy_pass http://localhost:3000/api/;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

5. **重启 Nginx**
   ```bash
   sudo systemctl restart nginx
   ```

### 配置域名和 HTTPS

1. **购买域名**（如阿里云、腾讯云）
2. **解析域名**到你的服务器 IP
3. **申请 SSL 证书**（免费使用 Let's Encrypt）
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d 你的域名
   ```

---

## 部署检查清单

- [ ] 前端能正常访问
- [ ] 后端 API 能正常响应
- [ ] AI 配置正确（API Key 有效）
- [ ] 风险检测功能正常
- [ ] HR 分析功能正常
- [ ] 报告页面能正常显示
- [ ] 反馈功能正常
- [ ] 隐私政策和免责声明页面可访问

---

## 常见问题

### Q1: 前端部署后无法访问后端 API？

**原因**：跨域问题或 API 地址配置错误

**解决**：
1. 检查 Vercel 或 Nginx 的环境变量 `VITE_API_BASE_URL` 是否正确
2. 确保后端服务已启动且能正常响应
3. 检查浏览器控制台的错误信息

### Q2: Render 后端服务总是休眠？

**原因**：Render 免费版有自动休眠机制

**解决**：
1. 升级到付费版（$7/月起）
2. 使用第三方服务定期 ping 你的后端（如 UptimeRobot）

### Q3: AI 调用失败？

**原因**：API Key 无效、余额不足、网络问题

**解决**：
1. 检查 API Key 是否正确配置
2. 登录 SiliconFlow/QwenCloud 查看账户余额
3. 查看后端日志：`pm2 logs joblens-backend`

### Q4: 报告数据丢失？

**原因**：当前使用内存存储，重启后数据会丢失

**解决**：
1. 在 Render 上添加 PostgreSQL 数据库
2. 配置 `DATABASE_URL` 环境变量
3. 运行 `npx prisma migrate deploy`

---

## 成本参考

| 服务 | 费用 |
|------|------|
| Vercel 前端托管 | 免费（100GB/月带宽） |
| Render 后端托管 | 免费（含休眠）/ $7+/月（无休眠） |
| SiliconFlow AI | 按需付费（约 ¥0.01-0.05/千 tokens） |
| QwenCloud AI | 按需付费（约 ¥0.01-0.03/千 tokens） |
| 云服务器（方案二） | ¥50-100/月 |

> **提示**：零服务器方案总成本可以控制在每月 ¥50 以内（主要是 AI 调用费用）。
