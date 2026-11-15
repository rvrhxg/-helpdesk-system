import { pathToFileURL } from 'node:url';
import { openDatabase } from './database.js';
import { hashPassword } from './security.js';

export function seedDemo(db,password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a 12–128 character demo password through stdin');
  if (db.prepare('SELECT count(*) AS n FROM users').get().n !== 0) throw new Error('Demo requires an empty database; existing data will not be modified');
  const hash=hashPassword(password);
  db.exec('BEGIN');
  try {
    const insert=db.prepare('INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?)');
    insert.run('client@example.test','Алексей Морозов',hash,'customer');
    insert.run('agent@example.test','Анна Волкова',hash,'agent');
    insert.run('other@example.test','Мария Соколова',hash,'customer');
    const tickets=[
      ['Не приходит письмо для входа','Письмо отсутствует во входящих и папке спам.','open','high'],
      ['Подключение нового сотрудника','Нужно добавить коллегу в рабочее пространство.','in_progress','normal'],
      ['Ошибка при экспорте отчёта','CSV-файл не формируется за выбранный период.','open','urgent'],
      ['Как изменить контактный email?','Подскажите порядок изменения контактных данных.','resolved','low'],
      ['Уточнение по доступам к проекту','Какие права нужны для просмотра отчётов?','closed','normal'],
      ['Мобильная версия личного кабинета','Не отображается история операций на телефоне.','in_progress','high']
    ];
    for(const [subject,description,status,priority] of tickets) {
      const result=db.prepare('INSERT INTO tickets(subject,description,status,priority,customer_id,assignee_id) VALUES(?,?,?,?,?,?)').run(subject,description,status,priority,1,status==='open'?null:2);
      if(status!=='open') db.prepare('INSERT INTO comments(ticket_id,author_id,body) VALUES(?,?,?)').run(result.lastInsertRowid,2,'Здравствуйте! Обращение принято, уточняем детали.');
    }
    db.prepare('INSERT INTO tickets(subject,description,customer_id) VALUES(?,?,?)').run('Обращение другого клиента','Доступно сотруднику поддержки, но не первому клиенту.',3);
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.env.DATABASE_PATH || !process.env.DATABASE_PATH.endsWith('.demo.sqlite')) throw new Error('Set DATABASE_PATH to a separate *.demo.sqlite file');
  let password='';for await(const chunk of process.stdin) { password+=chunk;if(password.length>256)throw new Error('Password too long'); }
  const db=openDatabase();
  try {seedDemo(db,password.replace(/\r?\n$/,''));console.log('Demo created. Accounts: client@example.test and agent@example.test. Use the password provided through stdin.');}
  finally {db.close();}
}
