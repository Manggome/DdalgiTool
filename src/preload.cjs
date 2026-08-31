const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 렌더러(window.pb)에 필요한 것만 노출한다.
contextBridge.exposeInMainWorld('pb', {
  // 작업 폴더
  init: () => ipcRenderer.invoke('pb:init'),
  chooseFolder: () => ipcRenderer.invoke('pb:chooseFolder'),
  listHtml: () => ipcRenderer.invoke('pb:listHtml'),
  openWorkDir: () => ipcRenderer.invoke('pb:openWorkDir'),
  readGuide: (which) => ipcRenderer.invoke('pb:readGuide', which),
  openLog: () => ipcRenderer.invoke('pb:openLog'),

  // 대화
  ask: (convId, prompt, attachments, opts) => ipcRenderer.invoke('pb:ask', convId, prompt, attachments, opts),
  stop: (convId) => ipcRenderer.invoke('pb:stop', convId),
  notifyDone: (payload) => ipcRenderer.invoke('pb:notifyDone', payload),
  setModel: (m) => ipcRenderer.invoke('pb:setModel', m),
  setPermissionMode: (m) => ipcRenderer.invoke('pb:setPermissionMode', m),
  getTheme: () => ipcRenderer.invoke('pb:getTheme'),
  setTheme: (t) => ipcRenderer.invoke('pb:setTheme', t),
  permissionReply: (r) => ipcRenderer.invoke('pb:permissionReply', r),
  usage: () => ipcRenderer.invoke('pb:usage'),
  accountUsage: () => ipcRenderer.invoke('pb:accountUsage'),
  resetUsage: () => ipcRenderer.invoke('pb:resetUsage'),
  newSession: (convId) => ipcRenderer.invoke('pb:newSession', convId),
  setActiveConv: (convId) => ipcRenderer.invoke('pb:setActiveConv', convId),
  attachSession: (p) => ipcRenderer.invoke('pb:attachSession', p),
  busyConvs: () => ipcRenderer.invoke('pb:busyConvs'),
  getContextUsage: () => ipcRenderer.invoke('pb:getContextUsage'),

  // 첨부
  pickFiles: () => ipcRenderer.invoke('pb:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('pb:pickFolder'),
  describePaths: (paths) => ipcRenderer.invoke('pb:describePaths', paths),
  savePastedImage: (p) => ipcRenderer.invoke('pb:savePastedImage', p),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // 미리보기
  previewOpen: (rel) => ipcRenderer.invoke('pb:preview:open', rel),
  previewBounds: (r) => ipcRenderer.invoke('pb:preview:bounds', r),
  previewReload: () => ipcRenderer.invoke('pb:preview:reload'),
  previewDevtools: () => ipcRenderer.invoke('pb:preview:devtools'),
  previewHide: () => ipcRenderer.invoke('pb:preview:hide'),
  previewStop: () => ipcRenderer.invoke('pb:preview:stop'),
  previewErrors: () => ipcRenderer.invoke('pb:preview:errors'),
  previewClearErrors: () => ipcRenderer.invoke('pb:preview:clearErrors'),

  // 연동 설정 (구글·슬랙·트렐로)
  connStatus: () => ipcRenderer.invoke('conn:status'),
  connGoogleImportSecret: () => ipcRenderer.invoke('conn:googleImportSecret'),
  connGoogleLogin: () => ipcRenderer.invoke('conn:googleLogin'),
  connGoogleWho: () => ipcRenderer.invoke('conn:googleWho'),
  connSlackSet: (token) => ipcRenderer.invoke('conn:slackSet', token),
  connTrelloSet: (p) => ipcRenderer.invoke('conn:trelloSet', p),
  connDisconnect: (service) => ipcRenderer.invoke('conn:disconnect', service),
  connSlackChannels: () => ipcRenderer.invoke('conn:slackChannels'),
  connTrelloBoards: () => ipcRenderer.invoke('conn:trelloBoards'),
  connPickUnityDir: () => ipcRenderer.invoke('conn:pickUnityDir'),
  connProjectSave: (links) => ipcRenderer.invoke('conn:projectSave', links),
  connSyncIndex: () => ipcRenderer.invoke('conn:syncIndex'),
  connWriteAllow: (action, key) => ipcRenderer.invoke('conn:writeAllow', action, key),
  connMeter: () => ipcRenderer.invoke('conn:meter'),
  onAutoAllowed: (cb) => ipcRenderer.on('pb:autoAllowed', (_e, p) => cb(p)),
  onIndexStatus: (cb) => ipcRenderer.on('pb:indexStatus', (_e, p) => cb(p)),
  onMeterEvent: (cb) => ipcRenderer.on('pb:meterEvent', (_e, p) => cb(p)),
  onExternalPage: (cb) => ipcRenderer.on('pb:externalPage', (_e, p) => cb(p)),

  // 인증·버전
  authStatus: () => ipcRenderer.invoke('pb:authStatus'),
  authLogin: () => ipcRenderer.invoke('pb:authLogin'),
  authLogout: () => ipcRenderer.invoke('pb:authLogout'),
  getVersions: () => ipcRenderer.invoke('pb:versions'),

  // 이벤트
  onStatus: (cb) => ipcRenderer.on('pb:status', (_e, m) => cb(m)),
  onAgentText: (cb) => ipcRenderer.on('pb:agentText', (_e, t) => cb(t)),
  onAgentTool: (cb) => ipcRenderer.on('pb:agentTool', (_e, p) => cb(p)),
  onAgentToolDone: (cb) => ipcRenderer.on('pb:agentToolDone', (_e, p) => cb(p)),
  onAgentThinking: (cb) => ipcRenderer.on('pb:agentThinking', (_e, t) => cb(t)),
  onAgentThinkTokens: (cb) => ipcRenderer.on('pb:agentThinkTokens', (_e, n) => cb(n)),
  onAgentToolProgress: (cb) => ipcRenderer.on('pb:agentToolProgress', (_e, p) => cb(p)),
  onAgentStatus: (cb) => ipcRenderer.on('pb:agentStatus', (_e, p) => cb(p)),
  onFilesChanged: (cb) => ipcRenderer.on('pb:filesChanged', (_e, p) => cb(p)),
  onPreviewError: (cb) => ipcRenderer.on('pb:previewError', (_e, p) => cb(p)),
  onPreviewStopped: (cb) => ipcRenderer.on('pb:previewStopped', (_e, p) => cb(p)),
  onAuthProgress: (cb) => ipcRenderer.on('pb:authProgress', (_e, m) => cb(m)),
  onThemeChanged: (cb) => ipcRenderer.on('pb:themeChanged', (_e, p) => cb(p)),
  onPermissionAsk: (cb) => ipcRenderer.on('pb:permissionAsk', (_e, p) => cb(p)),
  onPermissionClose: (cb) => ipcRenderer.on('pb:permissionClose', (_e, p) => cb(p)),
});
