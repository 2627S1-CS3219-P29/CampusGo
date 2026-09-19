# 19/9/2026
## 1
- Tool used: deepseek chat
- Mode: Generation
- Prompt:
```
create a login page in vuetify + typescript. mock any external calls made. requirements:
- email and password field
- upon error from server, display popup notification/alert
- 2 buttons: login and register
- register slides a form over the existing login form
- register has email and password field. additionally has a password complexity meter (list of what is missing/violated)
- enable client side validation through zod
```
- Prompt:
```
provide a typescript function to nicely format an error message in bulleted form of a similar variant to the following object provided:

{"error":"request schema violation","details":{"errors":[],"properties":{"password":{"errors":["Too big: expected string to have <=128 characters"]}}}}
```
- Output used (login.vue): most of the template and stylesheet was copied. state code was stripped of irrelevant code (mock data), the rest of the styling code was inspected as left intact. the fancy responsive password field was too complicated so it was removed. finally, integration was done by hooking up error handling, login and register apis/stores.
- Output used (zodErrorFormatter.ts): the second prompt was for the formatting of server side validation errors/general errors in the popup notification. the code is somewhat small and looks reasonable, so this was used with little modification.

