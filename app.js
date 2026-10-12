// 網頁互動：登入、示範聊天室、會員聊天。
// 不使用框架，方便直接在 Visual Studio 修改。
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.MOIRE_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  let client = null, user = null, demo = false, register = false, poll = null;
  let channel = null, sending = false, busy = false, rows = [], loading = false;
  let generation = 0, rendered = '';
  const storageKey = 'moire-demo-messages-v1';
  const dialog = $('login-dialog');
  $('year').textContent = new Date().getFullYear();

  function storageRead() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value.filter(r => typeof r.content === 'string' && typeof r.id === 'string').slice(-100) : [];
    } catch { return []; }
  }
  function saveDemo(next) {
    try { localStorage.setItem(storageKey, JSON.stringify(next.slice(-100))); }
    catch { throw new Error('瀏覽器無法儲存示範訊息，請確認儲存空間與隱私設定。'); }
  }
  function displayName(current) {
    return String(current?.user_metadata?.nickname || '會員').slice(0,24);
  }
  function resetAuth() {
    $('auth-status').textContent = '';
    $('password').value = '';
    $('password').type = 'password';
    $('toggle-password').textContent = '顯示';
  }
  function openLogin() {
    resetAuth();
    $('setup-notice').hidden = configured;
    $('auth-submit').disabled = !configured;
    if (!dialog.open) dialog.showModal();
  }
  ['open-login','start'].forEach(id => $(id).addEventListener('click', openLogin));
  $('close-login').onclick = () => dialog.close();
  dialog.addEventListener('click', e => { if(e.target === dialog) {const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();} });
  function setAuthMode(value) {
    register = value;
    resetAuth();
    $('nickname-row').hidden = !value;
    $('nickname').required = value;
    $('login-tab').classList.toggle('selected', !value);
    $('register-tab').classList.toggle('selected', value);
    $('password').autocomplete = value ? 'new-password' : 'current-password';
    $('auth-title').textContent = value ? '讓相遇，開始。' : '歡迎回來。';
    $('auth-subtitle').textContent = value ? '建立你的帳號，找到自在交流的角落。' : '登入後，在茶室與大家相遇。';
    $('auth-submit').textContent = value ? '建立帳號 ↗' : '登入墨遇 ↗';
  }
  $('login-tab').onclick = () => setAuthMode(false);
  $('register-tab').onclick = () => setAuthMode(true);
  $('toggle-password').onclick = () => {
    const visible = $('password').type === 'password';
    $('password').type = visible ? 'text' : 'password';
    $('toggle-password').textContent = visible ? '隱藏' : '顯示';
    $('toggle-password').setAttribute('aria-label',visible ? '隱藏密碼' : '顯示密碼');
  };

  async function getClient() {
    if(client) return client;
    if(!configured) throw new Error('會員服務尚未設定，請使用示範聊天室。');
    if(!window.supabase) {
      await new Promise((resolve,reject) => {
        const script=document.createElement('script');
        script.src='supabase.js'; script.onload=resolve;
        script.onerror=()=>reject(new Error('會員服務載入失敗，請稍後重試。'));
        document.head.append(script);
      });
    }
    client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey);
    client.auth.onAuthStateChange((event,session) => {
      if(event==='SIGNED_OUT' && !demo && user) leaveChat();
      if(session?.user && !demo) user=session.user;
    });
    return client;
  }
  function errorMessage(error) {
    const message=String(error?.message || '');
    if(message.includes('Invalid login credentials'))return '信箱或密碼不正確，請重新確認。';
    if(message.includes('Email not confirmed'))return '請先到電子信箱點選驗證連結，再登入。';
    if(message.includes('already registered'))return '此信箱已註冊，請切換至會員登入。';
    if(message.includes('rate limit'))return '操作太頻繁，請稍等一下再試。';
    if(/fetch|network/i.test(message))return '暫時無法連線，請檢查網路後重試。';
    if(/permission|policy|relation|schema/i.test(message))return '聊天資料庫尚未完成設定，請聯絡網站管理者。';
    return message || '發生錯誤，請稍後再試。';
  }
  $('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    if(busy)return;
    busy=true; $('auth-submit').disabled=true; $('auth-status').textContent='';
    try {
      const db=await getClient();
      const email=$('email').value.trim(), password=$('password').value;
      let result;
      if(register) {
        const nickname=$('nickname').value.trim();
        if(!nickname)throw new Error('請輸入你的暱稱。');
        result=await db.auth.signUp({email,password,options:{data:{nickname},emailRedirectTo:location.href.split('#')[0]}});
      } else result=await db.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      if(!result.data.session) {
        $('auth-status').textContent='請到電子信箱查看驗證信，完成驗證後再登入。如果信箱已註冊，請直接登入。';
        $('password').value='';
      } else {user=result.data.user;await enterChat(false);dialog.close();resetAuth();}
    } catch(error){$('auth-status').textContent=errorMessage(error);}
    finally {busy=false;$('auth-submit').disabled=!configured;}
  });

  function renderMessages() {
    const signature=JSON.stringify(rows.map(r=>[r.id,r.content,r.nickname]));
    if(signature===rendered)return;
    rendered=signature;
    const log=$('messages');
    const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<100;
    log.replaceChildren();
    if(!rows.length){
      const empty=document.createElement('div');empty.className='empty';
      empty.textContent='茶已備好，等你開口。';
      const subtitle=document.createElement('small');subtitle.textContent='這裡還沒有訊息，來說聲「你好」吧。';empty.append(subtitle);log.append(empty);
    }
    for(const row of rows){
      const own=demo ? row.user_id==='demo-self' : row.user_id===user?.id;
      const item=document.createElement('div');item.className='message'+(own?' own':'');
      const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=String(row.nickname||'會員').slice(0,1);
      const body=document.createElement('div');body.className='message-body';
      const meta=document.createElement('div');meta.className='message-meta';
      const name=document.createElement('span');name.textContent=own?'你':String(row.nickname||'會員');
      const date=new Date(row.created_at);const time=document.createElement('time');
      time.textContent=Number.isNaN(date.getTime())?'':date.toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=row.content;
      meta.append(name,time);body.append(meta,bubble);item.append(avatar,body);log.append(item);
    }
    if(nearBottom || sending)log.scrollTop=log.scrollHeight;
  }
  async function refresh() {
    if(demo){rows=storageRead();renderMessages();return;}
    if(loading || !user)return;
    loading=true;const currentGeneration=generation;
    try {
      const {data,error}=await client.from('moire_messages').select('id,user_id,nickname,content,created_at').order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      if(currentGeneration!==generation)return;
      rows=data.reverse();renderMessages();$('chat-error').textContent='';
    }catch(error){if(currentGeneration===generation)$('chat-error').textContent=errorMessage(error);}
    finally{loading=false;}
  }
  async function enterChat(isDemo) {
    generation++; demo=isDemo;rendered='';rows=[];
    $('welcome').hidden=true;$('chat').hidden=false;$('open-login').hidden=true;
    $('chat-notice').hidden=!demo;
    $('mode-label').textContent=demo?'示範模式 · 本機儲存':'會員';
    $('member-name').textContent=demo?'示範訪客':displayName(user);
    $('connection').textContent=demo?'● 示範模式':'● 正在連線';
    $('chat-error').textContent='';
    if(poll)clearInterval(poll);
    await refresh();
    if(!demo){
      channel=client.channel('moire-room').on('postgres_changes',{event:'INSERT',schema:'public',table:'moire_messages'},()=>refresh()).subscribe(status=>{
        if(demo || $('chat').hidden)return;
        $('connection').textContent=status==='SUBSCRIBED'?'● 已連線': '● 定時更新中';
      });
      poll=setInterval(()=>{if(!document.hidden)refresh();},5000);
    }
    $('message-input').focus();
  }
  function startDemo(){dialog.close();enterChat(true);}
  $('demo').onclick=startDemo;$('dialog-demo').onclick=startDemo;
  function leaveChat(){
    generation++;user=null;demo=false;rows=[];rendered='';
    if(poll)clearInterval(poll);poll=null;
    if(channel && client)client.removeChannel(channel);channel=null;
    $('welcome').hidden=false;$('chat').hidden=true;$('open-login').hidden=false;
    $('message-input').value='';$('char-count').textContent='0 / 1000';
  }
  $('logout').onclick=async()=>{
    if(!demo && client){
      const {error}=await client.auth.signOut();
      if(error){$('chat-error').textContent=errorMessage(error);return;}
    }
    leaveChat();
  };
  $('message-input').addEventListener('input',()=>{$('char-count').textContent=$('message-input').value.length+' / 1000';});
  $('message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('message-form').requestSubmit();}});
  $('message-form').addEventListener('submit',async e=>{
    e.preventDefault();const content=$('message-input').value.trim();if(!content||sending)return;
    if(content.length>1000){$('chat-error').textContent='訊息最多 1000 個字元。';return;}
    sending=true;$('send').disabled=true;$('chat-error').textContent='';
    try {
      if(demo){const next=storageRead();next.push({id:crypto.randomUUID(),user_id:'demo-self',nickname:'示範訪客',content,created_at:new Date().toISOString()});saveDemo(next);}
      else {
        if(!user)throw new Error('請重新登入後再送出訊息。');
        const {error}=await client.from('moire_messages').insert({user_id:user.id,nickname:displayName(user),content});if(error)throw error;
      }
      $('message-input').value='';$('char-count').textContent='0 / 1000';await refresh();
    }catch(error){$('chat-error').textContent=errorMessage(error);}
    finally{sending=false;$('send').disabled=false;$('message-input').focus();}
  });
  window.addEventListener('storage',e=>{if(e.key===storageKey && demo)refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && !$('chat').hidden)refresh();});
  if(configured)getClient().then(async db=>{const {data}=await db.auth.getSession();if(data.session){user=data.session.user;await enterChat(false);}}).catch(error=>{$('auth-status').textContent=errorMessage(error);});
})();
