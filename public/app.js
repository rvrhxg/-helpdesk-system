const $ = id => document.getElementById(id);
const statuses = { open: 'Открыто', in_progress: 'В работе', resolved: 'Решено', closed: 'Закрыто' };
const priorities = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' };
let slaSummary=null;
let user, tickets = [], filter = 'all', registering = false, page = 1, total = 0, stats = [];
const element = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
const date = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
async function api(path, method = 'GET', data) {
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (response.status === 401 && user && !path.startsWith('/auth/login')) {
    refreshVersion++; clearTimeout(searchTimer); user = null;
    $('identity').replaceChildren(); show('auth');
    throw new Error('Сессия завершена. Войдите снова.');
  }
  if (path.startsWith('/tickets?')) Object.defineProperty(result, 'totalCount', { value: Number(response.headers.get('X-Total-Count')) });
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос');
  return result;
}
function notice(error) { $('notice').textContent = error?.message || ''; }
async function busy(form, task) { const button = form.querySelector('[type="submit"]'); button.disabled = true; notice(); try { await task(); } catch (error) { notice(error); } finally { button.disabled = false; } }
function show(view) { for (const id of ['auth','dashboard','detail']) $(id).hidden = id !== view; }
function render() {
  $('identity').replaceChildren(element('span', `${user.name} · ${user.role === 'customer' ? 'Клиент' : 'Поддержка'}`));
  const logout = element('button','Выйти'); logout.onclick = async () => { try { await api('/auth/logout','POST',{}); refreshVersion++; clearTimeout(searchTimer); user = null; $('identity').replaceChildren(); show('auth'); } catch (error) { notice(error); } }; $('identity').append(logout);
  $('metrics').replaceChildren();
  const statusCount = status => stats.find(s=>s.status===status)?.count || 0;
  for (const [title, count, caption] of [['Всего обращений',stats.reduce((n,s)=>n+s.count,0),'Все доступные обращения'],['Открытые',statusCount('open'),'Ожидают ответа'],['В работе',statusCount('in_progress'),'Команда занимается решением'],['Решённые',statusCount('resolved')+statusCount('closed'),'Вопросы с результатом']]) {
    const card = element('div',undefined,'metric'); card.append(element('small',title),element('strong',count),element('span',caption)); $('metrics').append(card);
  }
  const rows = tickets;
  if(slaSummary&&user.role!=='customer'){for(const [label,key]of [['Первый ответ','first_response'],['Решение','resolution']]){const m=slaSummary[key],card=element('div',undefined,'metric');card.append(element('small',label+' · SLA'),element('strong',m.overdue_pending+' просрочено'),element('span',`Среднее: ${m.average_minutes===null?'—':Math.round(m.average_minutes)+' мин'} · В срок: ${m.on_time_percent===null?'—':Math.round(m.on_time_percent)+'%'}`));$('metrics').append(card);}}
  const footer = document.querySelector('.panel footer'); footer.replaceChildren();
  const prev = element('button','← Назад'); prev.disabled = page === 1;
  const next = element('button','Далее →'); next.disabled = page * 50 >= total;
  prev.onclick = () => { page--; refresh().catch(notice); }; next.onclick = () => { page++; refresh().catch(notice); };
  footer.append(prev,element('span',`Страница ${page} · Найдено: ${total}`),next);
  $('tickets').replaceChildren(); $('empty').hidden = rows.length > 0;
  for (const ticket of rows) {
    const row = element('tr'); const title = element('td'); const link = element('button', ticket.subject,'ticket-link'); link.onclick = () => openTicket(ticket.id).catch(notice); title.append(element('span',`#${String(ticket.id).padStart(4,'0')}`,'ticket-id'),link);
    const status = element('td'); status.append(element('span',statuses[ticket.status],`badge ${ticket.status}`));
    if(ticket.sla){const late=ticket.sla.first_response.overdue||ticket.sla.resolution.overdue;title.append(element('small',late?'SLA: просрочка':'SLA: в срок',late?'sla-late':'sla-ok'));}
    row.append(title,status,element('td',priorities[ticket.priority]),element('td',date(ticket.created_at))); $('tickets').append(row);
  }
}
let refreshVersion = 0;
async function refresh() { const version = ++refreshVersion; const [list,summary] = await Promise.all([api('/tickets?' + new URLSearchParams({page,q:$('search').value,status:filter === 'all' ? '' : filter})),api('/stats')]); if(version!==refreshVersion)return; slaSummary=user.role==='customer'?null:await api('/analytics');if(version!==refreshVersion)return;tickets=list; total=list.totalCount; stats=summary; render(); show('dashboard'); }
$('auth-toggle').onclick = () => { registering = !registering; $('name-label').hidden = !registering; $('auth-form').elements.name.required = registering; $('auth-title').textContent = registering ? 'Создать аккаунт' : 'Вход в аккаунт'; $('auth-toggle').textContent = registering ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'; $('auth-form').elements.password.autocomplete = registering ? 'new-password' : 'current-password'; };
$('auth-form').onsubmit = event => { event.preventDefault(); busy(event.target, async () => { user = await api('/auth/' + (registering ? 'register' : 'login'),'POST',Object.fromEntries(new FormData(event.target))); await refresh(); }); };
$('new-ticket').onclick = () => $('create-dialog').showModal(); $('close-dialog').onclick = () => $('create-dialog').close();
$('create-form').onsubmit = event => { event.preventDefault(); busy(event.target, async () => { await api('/tickets','POST',Object.fromEntries(new FormData(event.target))); event.target.reset(); $('create-dialog').close(); page = 1; filter = 'all'; $('search').value = ''; document.querySelectorAll('[data-filter]').forEach(t=>t.classList.toggle('selected',t.dataset.filter==='all')); await refresh(); }); };
let searchTimer;
$('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(()=>{page=1;refresh().catch(notice);},250); };
for (const tab of document.querySelectorAll('[data-filter]')) tab.onclick = () => { page=1; filter = tab.dataset.filter; document.querySelectorAll('[data-filter]').forEach(t=>t.classList.toggle('selected',t === tab)); refresh().catch(notice); };
async function openTicket(id) {
  refreshVersion++; clearTimeout(searchTimer);
  const [ticket, comments] = await Promise.all([api(`/tickets/${id}`),api(`/tickets/${id}/comments`)]);
  const root = $('detail'); root.replaceChildren(); const back = element('button','← Все обращения'); back.onclick = () => refresh().catch(notice); root.append(back,element('h1',ticket.subject));
  const card = element('div',undefined,'detail-card'); card.append(element('span',`#${ticket.id} · ${statuses[ticket.status]} · ${priorities[ticket.priority]}`,'muted'),element('p',ticket.description,'prose'));
  if (user.role !== 'customer') { const label = element('label','Статус обращения'); const select = element('select'); for (const [value,text] of Object.entries(statuses)) { const option = element('option',text); option.value = value; option.selected = value === ticket.status; select.append(option); } select.onchange = async () => { select.disabled = true; try { await api(`/tickets/${id}`,'PATCH',{status:select.value}); await openTicket(id); } catch(error) { notice(error); select.value = ticket.status; } finally { select.disabled = false; } }; label.append(select); card.append(label); }
  if(ticket.sla)for(const [label,key]of [['Первый ответ','first_response'],['Решение','resolution']]){const m=ticket.sla[key];card.append(element('p',`${label}: ${m.completed?'завершено':'ожидается'} · ${m.overdue?'просрочка':'в срок'} · до ${new Date(m.due_at).toLocaleString('ru-RU')}`,m.overdue?'sla-late':'sla-ok'));}
  card.append(element('h2','История диалога'));
  for (const comment of comments) { const entry = element('div',undefined,'comment'); entry.append(element('small',`${comment.author_name} · ${date(comment.created_at)}`),element('p',comment.body,'prose')); card.append(entry); }
  if (!comments.length) card.append(element('p','Комментариев пока нет.','muted'));
  const form = element('form'); const label = element('label','Ваш комментарий'); const textarea = element('textarea'); textarea.required = true; textarea.maxLength = 5000; textarea.rows = 3; label.append(textarea); const submit = element('button','Отправить','primary'); submit.type = 'submit'; form.append(label,submit); form.onsubmit = event => { event.preventDefault(); busy(form,async () => { await api(`/tickets/${id}/comments`,'POST',{body:textarea.value}); await openTicket(id); }); }; card.append(form); root.append(card); show('detail');
}
try { user = await api('/auth/me'); await refresh(); } catch { show('auth'); }

