// Calendar-hour SLA, UTC, no business-hours or pause rules.
export const policy = {low:[24,120],normal:[8,72],high:[2,24],urgent:[0.5,4]};
const time = value => Date.parse(value.includes('T') ? value : value.replace(' ','T')+'Z');
export function sla(ticket, now=Date.now()) {
  const [response, resolution]=policy[ticket.priority];
  const start=time(ticket.created_at);
  const metric=(hours,finished)=>({due_at:new Date(start+hours*3600000).toISOString(),elapsed_minutes:Math.max(0,((finished?time(finished):now)-start)/60000),overdue:(finished?time(finished):now)>start+hours*3600000,completed:Boolean(finished)});
  return {first_response:metric(response,ticket.first_response_at),resolution:metric(resolution,ticket.resolved_at),policy:'calendar-hours-v1'};
}
export function analytics(tickets,now=Date.now()) {
 const rows=tickets.map(t=>sla(t,now));
 const summarize=key=>{const all=rows.map(r=>r[key]),done=all.filter(m=>m.completed);return {completed:done.length,pending:all.length-done.length,overdue_pending:all.filter(m=>!m.completed&&m.overdue).length,breached:all.filter(m=>m.overdue).length,average_minutes:done.length?done.reduce((n,m)=>n+m.elapsed_minutes,0)/done.length:null,on_time_percent:done.length?100*done.filter(m=>!m.overdue).length/done.length:null};};
 return {total:tickets.length,first_response:summarize('first_response'),resolution:summarize('resolution')};
}
