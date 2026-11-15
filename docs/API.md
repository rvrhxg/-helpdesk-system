# REST API

JSON запросы и ответы. Все изменяющие запросы требуют `Content-Type: application/json` и `Origin`, точно совпадающий с `APP_ORIGIN` (по умолчанию `http://localhost:3000`). Аутентификация — cookie `session`; для API-клиента нужно сохранить `Set-Cookie` и отправлять cookie далее.

| Метод | Путь | Назначение |
|---|---|---|
| GET | /api/health | Проверка HTTP-сервера |
| POST | /api/auth/register | `{email,name,password}`; новый клиент |
| POST | /api/auth/login | `{email,password}` |
| POST | /api/auth/logout | Отозвать текущую сессию |
| GET | /api/auth/me | Профиль текущего пользователя |
| GET | /api/tickets?q=текст&page=1&status=open | 50 обращений на страницу; общее число в X-Total-Count |
| GET | /api/stats | Число доступных обращений по статусам, без ограничения страницей |
| POST | /api/tickets | `{subject,description,priority?}` |
| GET | /api/tickets/:id | Доступное обращение |
| PATCH | /api/tickets/:id | `{status}`; только сотрудник |
| GET | /api/tickets/:id/comments | Комментарии доступного обращения |
| POST | /api/tickets/:id/comments | `{body}` |

Статусы: `open`, `in_progress`, `resolved`, `closed`. Приоритеты: `low`, `normal`, `high`, `urgent`. Смена статуса назначает текущего сотрудника исполнителем.

Ошибки: `{error: "message"}`. Основные коды: 400 невалидные данные, 401 нет действующей сессии, 403 запрет действия/Origin, 404 обращение отсутствует либо недоступно, 409 email занят, 413 тело больше 32 KiB, 415 неверный Content-Type, 429 лимит входа, 500 внутренняя ошибка без раскрытия деталей.
