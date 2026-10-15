import path from 'path';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  issueBrowserSession,
  issueProxyCapability,
  passwordMatches,
  readCookie,
  validateProxyTarget,
  verifyBrowserSession,
  verifyProxyCapability,
} from './functions/_lib/proxy-security.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const proxyEnv = {
  PASSWORD: config.password,
  PROXY_SIGNING_SECRET: process.env.PROXY_SIGNING_SECRET || '',
  SESSION_SIGNING_SECRET: process.env.SESSION_SIGNING_SECRET || '',
  PROXY_ALLOWED_ORIGINS: process.env.PROXY_ALLOWED_ORIGINS || '',
};

const log = (...args) => {
  if (config.debug) {
    console.log('[DEBUG]', ...args);
  }
};

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace('{{PASSWORD}}', password ? 'required' : '');
  return content;
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(__dirname, 'player.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(__dirname, 'index.html');
        break;
    }
    
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

function browserSessionCookie(req, token, maxAge) {
  const forwardedProto = String(req.get('X-Forwarded-Proto') || '').split(',')[0].trim();
  const secure = req.secure || forwardedProto === 'https' ? '; Secure' : '';
  return `liberty_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

app.get('/api/auth-session', async (req, res) => {
  const token = readCookie(req.get('Cookie'), 'liberty_session');
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, authenticated: await verifyBrowserSession(token, proxyEnv) });
});

app.delete('/api/auth-session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Set-Cookie', browserSessionCookie(req, '', 0));
  return res.json({ success: true });
});

app.post('/api/auth-session', express.json({ limit: '1kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!await passwordMatches(req.body?.password, proxyEnv)) {
    return res.status(401).json({ success: false, error: 'invalid_password' });
  }
  const session = await issueBrowserSession(proxyEnv);
  if (!session) return res.status(503).json({ success: false, error: 'session_not_configured' });
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  res.set('Set-Cookie', browserSessionCookie(req, session.token, maxAge));
  return res.json({ success: true, expiresAt: session.expiresAt });
});

app.post('/api/proxy-token', express.json({ limit: '8kb' }), async (req, res) => {
  const sessionToken = readCookie(req.get('Cookie'), 'liberty_session');
  if (!await verifyBrowserSession(sessionToken, proxyEnv)) {
    res.set('Cache-Control', 'no-store');
    return res.status(401).json({ success: false, error: 'proxy_auth_required' });
  }
  const capability = await issueProxyCapability({
    env: proxyEnv,
    target: req.body?.target,
    method: req.body?.method,
  });
  res.set('Cache-Control', 'no-store');
  if (!capability.ok) {
    return res.status(capability.reason === 'proxy_signing_not_configured' ? 503 : 403).json({
      success: false,
      error: capability.reason,
    });
  }
  return res.json({
    success: true,
    expiresAt: capability.expiresAt,
    nonce: capability.nonce,
    signature: capability.signature,
  });
});

app.get('/proxy/:encodedUrl', async (req, res) => {
  try {
    const encodedUrl = req.params.encodedUrl;
    const targetUrl = decodeURIComponent(encodedUrl);
    const targetValidation = validateProxyTarget(targetUrl, proxyEnv);
    if (!targetValidation.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).json({ success: false, error: targetValidation.reason });
    }
    const authorization = await verifyProxyCapability({
      env: proxyEnv,
      method: 'GET',
      target: targetValidation.target,
      expiresAt: req.query.pxe,
      nonce: req.query.pxn,
      signature: req.query.pxs,
    });
    if (!authorization.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(401).json({ success: false, error: authorization.reason });
    }

    const response = await fetch(authorization.target, {
      headers: {
        Accept: req.get('Accept') || 'application/json,text/plain,text/html,*/*',
        'User-Agent': config.userAgent,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeout),
    });
    if (!response.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(response.status).json({ success: false, error: 'proxy_upstream_error' });
    }
    const contentType = response.headers.get('Content-Type') || '';
    if (!/^(?:application\/(?:json|[^;]+\+json|xml)|text\/(?:plain|html|xml|csv))(?:;|$)/iu.test(contentType)) {
      res.set('Cache-Control', 'no-store');
      return res.status(415).json({ success: false, error: 'unsafe_response_type' });
    }
    const declaredLength = Number(response.headers.get('Content-Length') || 0);
    if (declaredLength > 5 * 1024 * 1024) {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({ success: false, error: 'response_too_large' });
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body || []) {
      received += chunk.byteLength;
      if (received > 5 * 1024 * 1024) {
        res.set('Cache-Control', 'no-store');
        return res.status(502).json({ success: false, error: 'response_too_large' });
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks, received);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store');
    return res.send(body);
  } catch (error) {
    res.set('Cache-Control', 'no-store');
    return res.status(error?.name === 'TimeoutError' ? 504 : 502).json({
      success: false,
      error: error?.name === 'TimeoutError' ? 'proxy_timeout' : 'proxy_upstream_unavailable',
    });
  }
});

app.use(express.static(path.join(__dirname), {
  maxAge: config.cacheMaxAge
}));

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    res.set('Cache-Control', 'no-store');
    return res.status(413).json({ success: false, error: 'request_too_large' });
  }
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);
  if (config.password !== '') {
    console.log('用户登录密码已设置');
  } else {
    console.log('警告: 未设置 PASSWORD 环境变量，用户将被要求设置密码');
  }
  if (config.debug) {
    console.log('调试模式已启用');
    console.log('配置:', { ...config, password: config.password ? '******' : '' });
  }
});
