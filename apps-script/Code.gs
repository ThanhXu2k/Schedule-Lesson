/* Public entry points: doGet, api, setup, weeklyAutomation. Helpers are private. */
var FREE_ONLY_MODE = true;
var ALLOW_PAID_SERVICES = false;
var SCHEMA_ = {
  Students:['student_id','full_name','email','timezone','english_level','status','hourly_rate','currency','notes','created_at','updated_at','phone','learning_goals','profile_picture','start_date'],
  RecurringSchedules:['schedule_id','student_id','day_of_week','start_time','duration_minutes','timezone','recurrence_frequency','effective_start_date','effective_end_date','status','created_at','updated_at','dst_fold'],
  Lessons:['lesson_id','occurrence_key','schedule_id','student_id','original_scheduled_start','start_datetime','end_datetime','duration_minutes','timezone','google_calendar_event_id','google_meet_url','lesson_status','sync_status','conference_status','invitation_status','attendee_response_status','lesson_notes','created_at','updated_at','student_name','student_email','calendar_id','calendar_event_url','integration_mode','conference_attempt','change_history','pending_action','last_error','revision'],
  AutomationLogs:['execution_id','execution_datetime','trigger_type','target_start_date','target_end_date','total_lessons','successful_lessons','skipped_lessons','conflicting_lessons','failed_lessons','execution_status','error_details','duration_ms'],
  Settings:['setting_key','setting_value','updated_at']
};

function setup() {
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var p=PropertiesService.getScriptProperties(),who=Session.getEffectiveUser().getEmail().toLowerCase();
    Scheduler.need(who,'Your Google account identity is unavailable.');
    Scheduler.need(!p.getProperty('OWNER_EMAIL')||p.getProperty('OWNER_EMAIL')===who,'Only the configured owner may initialize the app.','AUTH');
    var ss=p.getProperty('SPREADSHEET_ID')?SpreadsheetApp.openById(p.getProperty('SPREADSHEET_ID')):SpreadsheetApp.getActiveSpreadsheet();
    if(!ss)ss=SpreadsheetApp.create('Teaching Scheduler — private data');
    p.setProperties({OWNER_EMAIL:who,SPREADSHEET_ID:ss.getId()});
    Object.keys(SCHEMA_).forEach(function(t){var sh=ss.getSheetByName(t)||ss.insertSheet(t);if(sh.getLastRow()===0){sh.getRange(1,1,1,SCHEMA_[t].length).setValues([SCHEMA_[t]]).setFontWeight('bold');sh.setFrozenRows(1);}});
    var repo=new SheetsRepo_();
    if(!repo.all('Settings').length)Object.keys(Scheduler.DEFAULTS).forEach(function(k){repo.put('Settings',{setting_key:k,setting_value:k==='teacher_email'?who:Scheduler.DEFAULTS[k],updated_at:new Date().toISOString()});});
    repo.flush();
    return {spreadsheet_url:ss.getUrl(),mode:'mock',live_operations:false,automation:false};
  } finally {lock.releaseLock();}
}

function authorize_(trigger) {
  var p=PropertiesService.getScriptProperties(),owner=p.getProperty('OWNER_EMAIL');
  Scheduler.need(owner&&p.getProperty('SPREADSHEET_ID'),'Run setup in the Apps Script editor first.','SETUP');
  var active=(trigger?Session.getEffectiveUser():Session.getActiveUser()).getEmail().toLowerCase();
  Scheduler.need(active&&active===owner,'Access is restricted to the configured teacher.','AUTH');
}
function doGet() {authorize_(false);return HtmlService.createHtmlOutputFromFile('Index').setTitle('Teaching Scheduler').addMetaTag('viewport','width=device-width, initial-scale=1');}

function SheetsRepo_() {
  var ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')),state={},self=this;this.sheets={};this.dirty={};
  Object.keys(SCHEMA_).forEach(function(t){var sh=ss.getSheetByName(t);Scheduler.need(sh,'Database sheet missing. Restore the database.','STORAGE');self.sheets[t]=sh;var rows=sh.getDataRange().getValues(),headers=rows.shift();Scheduler.need(JSON.stringify(headers.slice(0,SCHEMA_[t].length))===JSON.stringify(SCHEMA_[t]),'Database schema differs. Restore the matching schema.','STORAGE');state[t]=rows.filter(function(r){return r[0]!=='';}).map(function(r){var obj={};SCHEMA_[t].forEach(function(k,i){try{obj[k]=r[i]===''?'':JSON.parse(String(r[i]));}catch(_){Scheduler.fail('Database cells must use the documented JSON encoding.','STORAGE');}});return obj;});var ids={};state[t].forEach(function(r){var id=r[Scheduler.IDS[t]];Scheduler.need(!ids[id],'Duplicate database IDs require manual reconciliation.','STORAGE');ids[id]=true;});});
  this.memory=new Scheduler.MemoryRepo(state);this.all=function(t){return self.memory.all(t);};this.settings=function(){return self.memory.settings();};
  this.put=function(t,row){self.memory.put(t,row);self.dirty[t]=true;self.flushTable(t);return row;};
  this.flushTable=function(t){if(!self.dirty[t])return;var rows=state[t],columns=SCHEMA_[t],sh=self.sheets[t];if(rows.length){var range=sh.getRange(2,1,rows.length,columns.length);range.setNumberFormat('@');range.setValues(rows.map(function(row){return columns.map(function(k){return JSON.stringify(row[k]===undefined?'':row[k]);});}));}SpreadsheetApp.flush();delete self.dirty[t];};
  this.flush=function(){Object.keys(self.dirty).forEach(self.flushTable);};
}

function quotaCall_(fn) {
  var p=PropertiesService.getScriptProperties(),now=Date.now(),q=JSON.parse(p.getProperty('QUOTA_STATE')||'{}');
  if(!q.start||now-q.start>=86400000)q={start:now,calls:0,halt_until:q.halt_until||0};
  Scheduler.need(!(q.halt_until>now)&&q.calls<1000,'Free-mode request budget reached. Wait for the cooldown and retry.','QUOTA');
  q.calls++;p.setProperty('QUOTA_STATE',JSON.stringify(q));
  for(var attempt=0;attempt<3;attempt++){
    try{return fn();}catch(error){
      var m=String(error&&error.message||error);
      if(/quota|rate.?limit|too many|resource.?exhausted|429|daily limit|limit exceeded/i.test(m)){q.halt_until=now+86400000;p.setProperty('QUOTA_STATE',JSON.stringify(q));Scheduler.fail('Google quota reached. Live requests are paused for 24 hours.','QUOTA');}
      if(/401|403|permission|forbidden|authorization|unauthorized|access.?denied/i.test(m))Scheduler.fail('Google authorization is unavailable. Reauthorize in the script editor.','AUTH');
      if(/404|410|not found|gone/i.test(m))Scheduler.fail('Calendar resource was not found.','MISSING_EVENT');
      if(/409|already exists|duplicate/i.test(m))Scheduler.fail('Event already exists. Retry safely to reconcile it.','ALREADY_EXISTS');
      if(attempt<2&&/500|502|503|504|backend.?error|internal.?error|temporarily unavailable/i.test(m)){q.calls++;Scheduler.need(q.calls<=1000,'Free-mode request budget reached.','QUOTA');p.setProperty('QUOTA_STATE',JSON.stringify(q));Utilities.sleep(300*Math.pow(2,attempt)+Math.floor(Math.random()*200));continue;}
      Scheduler.fail('Google Calendar request failed. Review authorization and retry.','SERVICE');
    }
  }
}

function GoogleCalendar_(repo) {
  var self=this;this.mode='live';
  function selected(id){return id||repo.settings().calendar_id;}
  function writeReady(){Scheduler.need(repo.settings().live_enabled===true&&FREE_ONLY_MODE&&!ALLOW_PAID_SERVICES,'Live calendar operations are disabled.','LIVE_DISABLED');}
  this.get=function(id,calendarId){try{return quotaCall_(function(){return Calendar.Events.get(selected(calendarId),id);});}catch(e){if(e.code==='MISSING_EVENT')return null;throw e;}};
  this.insert=function(body,calendarId){writeReady();try{return quotaCall_(function(){return Calendar.Events.insert(body,selected(calendarId),{conferenceDataVersion:1,sendUpdates:'all'});});}catch(e){if(e.code==='ALREADY_EXISTS'){var existing=self.get(body.id,calendarId);Scheduler.need(existing,'Existing event is not readable.','SERVICE');return existing;}throw e;}};
  this.update=function(id,body,calendarId){writeReady();return quotaCall_(function(){return Calendar.Events.patch(body,selected(calendarId),id,{conferenceDataVersion:1,sendUpdates:'all'});});};
  this.remove=function(id,calendarId){writeReady();try{return quotaCall_(function(){return Calendar.Events.remove(selected(calendarId),id,{sendUpdates:'all'});});}catch(e){if(e.code!=='MISSING_EVENT')throw e;}};
  this.poll=function(id,calendarId,current){for(var n=0;n<2;n++){Utilities.sleep(300*(n+1));var event=self.get(id,calendarId);if(!event)return current;current=event;var status=event.conferenceData&&event.conferenceData.createRequest&&event.conferenceData.createRequest.status;if(event.hangoutLink||(status&&status.statusCode!=='pending'))break;}return current;};
  this.busy=function(start,end,exclude,calendarOverride){
    var busy=[],calendarId=selected(calendarOverride),token=null,pages=0;
    // Listing the teaching calendar lets us exclude the exact event being updated.
    do{var page=quotaCall_(function(){return Calendar.Events.list(calendarId,{timeMin:start,timeMax:end,singleEvents:true,showDeleted:false,maxResults:250,pageToken:token||undefined});});(page.items||[]).forEach(function(e){if(e.id===exclude||e.status==='cancelled'||e.transparency==='transparent')return;var own=(e.attendees||[]).find(function(a){return a.self;});if(own&&own.responseStatus==='declined')return;var tz=e.start.timeZone||page.timeZone||repo.settings().timezone;busy.push({start:e.start.dateTime||Scheduler.zoned(e.start.date,'00:00',tz,'earlier'),end:e.end.dateTime||Scheduler.zoned(e.end.date,'00:00',tz,'earlier')});});token=page.nextPageToken;pages++;Scheduler.need(!token||pages<20,'Calendar is too large for a safe conflict scan. Narrow the generation range.','TIME_BUDGET');}while(token);
    var ids=Array.from(new Set(repo.settings().conflict_calendars.concat([selected()]))).filter(function(id){return id!==calendarId;});
    if(ids.length){var response=quotaCall_(function(){return Calendar.Freebusy.query({timeMin:start,timeMax:end,items:ids.map(function(id){return {id:id};})});});ids.forEach(function(id){var c=response.calendars&&response.calendars[id];Scheduler.need(c&&!(c.errors&&c.errors.length),'A conflict calendar is unavailable. No lesson was created.','CALENDAR_UNAVAILABLE');busy=busy.concat(c.busy||[]);});}
    return busy;
  };
  this.calendars=function(){var result=[],token;do{var page=quotaCall_(function(){return Calendar.CalendarList.list({maxResults:250,pageToken:token||undefined});});result=result.concat((page.items||[]).map(function(c){return {id:c.id,name:c.summary,access_role:c.accessRole,timezone:c.timeZone,meet_supported:!!(c.conferenceProperties&&c.conferenceProperties.allowedConferenceSolutionTypes||[]).includes('hangoutsMeet')};}));token=page.nextPageToken;}while(token);return result;};
  this.test=function(){var c=quotaCall_(function(){return Calendar.Calendars.get(selected());});var list=self.calendars(),entry=list.find(function(x){return x.id===c.id;});Scheduler.need(entry&&['owner','writer'].includes(entry.access_role),'Select a calendar with write access.','AUTH');Scheduler.need((c.conferenceProperties&&c.conferenceProperties.allowedConferenceSolutionTypes||[]).includes('hangoutsMeet'),'This calendar does not support Google Meet conference creation.');self.busy(new Date().toISOString(),new Date(Date.now()+3600000).toISOString());return {connected:true,calendar_name:c.summary,meet_supported:true};};
}

function context_() {
  var repo=new SheetsRepo_(),settings=repo.settings(),p=PropertiesService.getScriptProperties(),properties=p.getProperties(),mockEvents={};
  Object.keys(properties).filter(function(k){return k.indexOf('MOCK_EVENT_')===0;}).forEach(function(k){mockEvents[k.slice(11)]=JSON.parse(properties[k]);});
  // Apps Script development mode persists mock events alongside lessons, not in Calendar.
  var calendar=settings.live_enabled?new GoogleCalendar_(repo):new Scheduler.MockCalendar(mockEvents,function(events){Scheduler.need(Object.keys(events).length<=200,'Development calendar has reached its 200-event limit. Export and clear development data before continuing.','STORAGE');var encoded={};Object.keys(events).forEach(function(id){var value=JSON.stringify(events[id]);Scheduler.need(value.length<8000,'Development event exceeds storage limits.','STORAGE');encoded['MOCK_EVENT_'+id]=value;});p.setProperties(encoded);});
  return {repo:repo,calendar:calendar,engine:new Scheduler.Engine(repo,calendar,{uuid:function(){return Utilities.getUuid();},deadline:Date.now()+240000})};
}
function setting_(repo,key,value){repo.put('Settings',{setting_key:key,setting_value:value,updated_at:new Date().toISOString()});}
function triggerStatus_(){var p=PropertiesService.getScriptProperties(),s=JSON.parse(p.getProperty('QUOTA_STATE')||'{}');return {quota_calls:s.calls||0,quota_limit:1000,halt_until:s.halt_until?new Date(s.halt_until).toISOString():'',next_window:nextWindow_()};}
function nextWindow_(){var p=PropertiesService.getScriptProperties(),config=JSON.parse(p.getProperty('TRIGGER_CONFIG')||'null');if(!config)return '';var d=Scheduler.localDate(new Date().toISOString(),config.timezone);for(var i=0;i<8;i++){var x=Scheduler.dayAdd(d,i);if(new Date(x+'T12:00Z').getUTCDay()===config.day){try{var at=Scheduler.zoned(x,String(config.hour).padStart(2,'0')+':00',config.timezone,'earlier');if(Date.parse(at)+3600000>Date.now())return x+' '+String(config.hour).padStart(2,'0')+':00–'+String(config.hour+1).padStart(2,'0')+':00 '+config.timezone;}catch(_){}}}return '';}

function api(action,input) {
  try {
    authorize_(false);Scheduler.need(typeof action==='string'&&JSON.stringify(input||{}).length<50000,'Invalid request.');
    var lock=LockService.getScriptLock();Scheduler.need(lock.tryLock(10000),'Another operation is running. Try again shortly.','LOCKED');
    try{return {ok:true,data:dispatch_(action,input||{})};}finally{lock.releaseLock();}
  }catch(e){return {ok:false,error:{code:e.code||'SERVICE',message:e.code?e.message:'The operation failed. Check the deployment and database configuration.'}};}
}
function dispatch_(action,input) {
  var c=context_(),e=c.engine,p=PropertiesService.getScriptProperties();
  switch(action){
    case 'snapshot':var snap=e.snapshot();snap.runtime=triggerStatus_();return snap;
    case 'saveStudent':return e.saveStudent(input);
    case 'saveSchedule':return e.saveSchedule(input);
    case 'preview':return e.preview(input.start?input:null);
    case 'generate':Scheduler.need(input.confirm===true,'Preview and confirm weekly generation first.');return e.generate(input.range,'Manual');
    case 'createLesson':return e.createLesson(input);
    case 'reschedule':return e.reschedule(input);
    case 'cancel':return e.cancel(input.lesson_id);
    case 'attend':return e.attend(input);
    case 'notes':return e.notes(input);
    case 'retry':return e.sync(input.lesson_id,true);
    case 'reconcile':return e.reconcileAll();
    case 'saveSettings':Scheduler.need(!c.repo.settings().automation_enabled,'Disable automation before changing settings.');return e.saveSettings(input);
    case 'calendars':return new GoogleCalendar_(c.repo).calendars();
    case 'testConnection':var result=new GoogleCalendar_(c.repo).test();p.setProperty('CONNECTION_VERIFIED',JSON.stringify({calendar_id:c.repo.settings().calendar_id,at:Date.now()}));return result;
    case 'enableLive':
      Scheduler.need(input.confirm===true&&input.free_tier_confirmed===true,'Confirm that this Google project uses the no-cost Standard Tier with billing disabled.');
      Scheduler.need(c.repo.all('Lessons').every(function(l){return l.integration_mode==='live';}),'Export and clear development lessons before enabling live operations.');
      new GoogleCalendar_(c.repo).test();setting_(c.repo,'live_enabled',true);clearMockEvents_();return {live_enabled:true};
    case 'disableLive':removeTriggers_();setting_(c.repo,'automation_enabled',false);setting_(c.repo,'live_enabled',false);return {live_enabled:false};
    case 'enableAutomation':
      Scheduler.need(input.confirm===true&&c.repo.settings().live_enabled,'Enable live operations and confirm automation first.');new GoogleCalendar_(c.repo).test();removeTriggers_();
      var s=c.repo.settings(),days=[ScriptApp.WeekDay.SUNDAY,ScriptApp.WeekDay.MONDAY,ScriptApp.WeekDay.TUESDAY,ScriptApp.WeekDay.WEDNESDAY,ScriptApp.WeekDay.THURSDAY,ScriptApp.WeekDay.FRIDAY,ScriptApp.WeekDay.SATURDAY];
      ScriptApp.newTrigger('weeklyAutomation').timeBased().everyWeeks(1).onWeekDay(days[s.automation_day]).atHour(s.automation_hour).inTimezone(s.timezone).create();
      ScriptApp.newTrigger('conferenceReconciliation').timeBased().everyHours(1).create();
      p.setProperty('TRIGGER_CONFIG',JSON.stringify({day:s.automation_day,hour:s.automation_hour,timezone:s.timezone}));setting_(c.repo,'automation_enabled',true);return triggerStatus_();
    case 'disableAutomation':removeTriggers_();setting_(c.repo,'automation_enabled',false);return {automation_enabled:false};
    case 'clearDevelopment':
      Scheduler.need(!c.repo.settings().live_enabled&&!c.repo.settings().automation_enabled&&input.confirm===true,'Disable live operations first and confirm clearing development lessons.');
      Scheduler.need(c.repo.all('Lessons').every(function(l){return l.integration_mode==='mock';}),'Live lesson records cannot be cleared.');
      ['Lessons','AutomationLogs'].forEach(function(t){var sh=c.repo.sheets[t];if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,SCHEMA_[t].length).clearContent();});clearMockEvents_();return {cleared:true};
    default:Scheduler.fail('Unknown operation.');
  }
}
function clearMockEvents_(){var p=PropertiesService.getScriptProperties();Object.keys(p.getProperties()).filter(function(k){return k.indexOf('MOCK_EVENT_')===0||k==='MOCK_EVENTS';}).forEach(function(k){p.deleteProperty(k);});}
function removeTriggers_(){ScriptApp.getProjectTriggers().filter(function(t){return ['weeklyAutomation','conferenceReconciliation'].includes(t.getHandlerFunction());}).forEach(function(t){ScriptApp.deleteTrigger(t);});PropertiesService.getScriptProperties().deleteProperty('TRIGGER_CONFIG');}
function weeklyAutomation() {
  authorize_(true);var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try{var c=context_();if(!c.repo.settings().live_enabled||!c.repo.settings().automation_enabled)return;c.engine.generate(null,'Weekly Trigger');}finally{lock.releaseLock();}
}
function conferenceReconciliation() {
  authorize_(true);var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try{var c=context_();if(!c.repo.settings().live_enabled||!c.repo.settings().automation_enabled)return;
    var lessons=c.repo.all('Lessons').filter(function(l){return l.integration_mode==='live'&&l.sync_status==='Synced'&&l.conference_status==='Pending'&&l.google_calendar_event_id&&['Scheduled','Rescheduled'].includes(l.lesson_status)&&l.end_datetime>new Date().toISOString();}).slice(0,25);
    for(var i=0;i<lessons.length;i++){try{c.engine.reconcile(lessons[i].lesson_id);}catch(e){if(['QUOTA','AUTH'].includes(e.code))break;}}
  }finally{lock.releaseLock();}
}
