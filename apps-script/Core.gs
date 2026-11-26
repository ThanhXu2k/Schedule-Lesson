/* Shared synchronous domain engine. No network access; all side effects are injected. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TABLES = ['Students', 'RecurringSchedules', 'Lessons', 'AutomationLogs', 'Settings'];
  const IDS = {Students:'student_id', RecurringSchedules:'schedule_id', Lessons:'lesson_id', AutomationLogs:'execution_id', Settings:'setting_key'};
  const DEFAULTS = {teacher_name:'Your workspace', teacher_email:'', timezone:'Asia/Ho_Chi_Minh', default_duration:60, currency:'USD', theme:'System', calendar_id:'primary', conflict_calendars:[], live_enabled:false, automation_enabled:false, automation_day:0, automation_hour:18, generation_weeks:1, reminders_enabled:true, reminder_minutes:[1440,60,10], FREE_ONLY_MODE:true, ALLOW_PAID_SERVICES:false};
  const STATUSES = ['Scheduled','Completed','Cancelled','Rescheduled','Student Absent','Teacher Absent'];
  const copy = x => JSON.parse(JSON.stringify(x));
  function fail(message, code) { const e = new Error(message); e.code = code || 'VALIDATION'; throw e; }
  function need(condition, message, code) { if (!condition) fail(message,code); }
  function text(value, max) { return String(value == null ? '' : value).trim().slice(0,max || 2000); }
  function email(value) { const v=text(value,254).toLowerCase(); need(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v),'Enter a valid email address.'); return v; }
  function zone(value) { const v=text(value,100); try { new Intl.DateTimeFormat('en',{timeZone:v}).format(new Date()); } catch (_) { fail('Choose a valid IANA timezone.'); } return v; }
  function date(value) { need(/^\d{4}-\d{2}-\d{2}$/.test(value || '') && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value,'Choose a valid date.'); return value; }
  function integer(value,min,max) { const n=Number(value); need(Number.isInteger(n)&&n>=min&&n<=max,'Number must be between '+min+' and '+max+'.'); return n; }
  function dayAdd(d,n) { date(d); return new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10); }
  function parts(instant,tz) { const p={}; new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).forEach(x=>{if(x.type!=='literal')p[x.type]=x.value;}); return p; }
  function localDate(instant,tz) { const p=parts(instant,tz); return p.year+'-'+p.month+'-'+p.day; }
  function zoned(d,t,tz,fold) {
    date(d); zone(tz); need(/^([01]\d|2[0-3]):[0-5]\d$/.test(t),'Choose a valid start time.');
    const wall=Date.parse(d+'T'+t+':00Z'), offsets=new Set();
    [-36,-24,-12,0,12,24,36].forEach(h=>{ const x=wall+h*3600000,p=parts(x,tz); offsets.add(Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+'Z')-x); });
    const options=[]; offsets.forEach(o=>{const x=wall-o,p=parts(x,tz); if(p.year+'-'+p.month+'-'+p.day===d && p.hour+':'+p.minute===t) options.push(x);}); options.sort((a,b)=>a-b);
    need(options.length,'This local time does not exist because clocks change. Choose another time.','DST_GAP');
    if(options.length>1 && !fold) fail('This time occurs twice. Choose the earlier or later offset.','DST_FOLD');
    return new Date(options[fold==='later'?options.length-1:0]).toISOString();
  }
  function nextWeek(now,tz,weeks) { const d=localDate(now,tz),dow=new Date(d+'T12:00Z').getUTCDay(),start=dayAdd(d,((8-dow)%7)||7); return {start,end:dayAdd(start,7*(weeks||1)-1)}; }
  function overlap(a,b) { return Date.parse(a.start_datetime||a.start)<Date.parse(b.end_datetime||b.end) && Date.parse(b.start_datetime||b.start)<Date.parse(a.end_datetime||a.end); }
  function conflictMessage(conflicts,tz) {return conflicts.length?'Conflict: '+conflicts.slice(0,3).map(c=>{const a=parts(c.start,tz),b=parts(c.end,tz);return a.year+'-'+a.month+'-'+a.day+' '+a.hour+':'+a.minute+'–'+b.hour+':'+b.minute;}).join(', ')+' ('+tz+'). Choose a different time.':'No conflict.';}
  function hash(s) { let out=''; for(let k=0;k<4;k++){let n=(2166136261+k*1000003)>>>0; for(let i=0;i<s.length;i++){n^=s.charCodeAt(i); n=Math.imul(n,16777619); n^=n>>>13;} out+=(n>>>0).toString(16).padStart(8,'0');} return out; }
  function eventId(l) { return 'ts'+hash(l.lesson_id); }
  function eventBody(l,settings,retryConference) {
    const b={id:eventId(l),summary:'English Lesson – '+l.student_name,description:'Private lesson · '+l.duration_minutes+' minutes',start:{dateTime:l.start_datetime,timeZone:l.timezone},end:{dateTime:l.end_datetime,timeZone:l.timezone},attendees:[{email:l.student_email}],visibility:'private',guestsCanInviteOthers:false,guestsCanSeeOtherGuests:false,guestsCanModify:false,extendedProperties:{private:{application:'teaching-scheduler',lesson_id:l.lesson_id,occurrence_key:l.occurrence_key}},reminders:{useDefault:false,overrides:settings.reminders_enabled?settings.reminder_minutes.map(m=>({method:'popup',minutes:m})):[]}};
    if(!l.google_meet_url) b.conferenceData={createRequest:{requestId:l.lesson_id+'-'+(retryConference||0),conferenceSolutionKey:{type:'hangoutsMeet'}}};
    return b;
  }
  class MemoryRepo {
    constructor(state,save) { this.state=state || {}; TABLES.forEach(t=>{if(!Array.isArray(this.state[t]))this.state[t]=[];}); this.save=save||function(){}; }
    all(t) { need(TABLES.includes(t),'Unknown table.'); return copy(this.state[t]); }
    put(t,row) { const key=IDS[t]; need(row[key],'Record ID is required.'); const rows=this.state[t],i=rows.findIndex(x=>x[key]===row[key]); if(t==='Lessons')need(!rows.some(x=>x.lesson_id!==row.lesson_id&&x.occurrence_key===row.occurrence_key),'This occurrence already exists.','DUPLICATE'); if(i<0)rows.push(copy(row)); else rows[i]=copy(row); this.save(this.state); return copy(row); }
    settings() { const s=copy(DEFAULTS); this.all('Settings').forEach(r=>s[r.setting_key]=r.setting_value); return s; }
  }
  class MockCalendar {
    constructor(events,save) {this.events=events||{};this.save=save||function(){};this.mode='mock';this.externalBusy=[];}
    busy(start,end,exclude) {return this.externalBusy.concat(Object.values(this.events).filter(e=>e.status!=='cancelled'&&e.id!==exclude).map(e=>({start:e.start.dateTime,end:e.end.dateTime}))).filter(e=>overlap(e,{start,end}));}
    get(id) {return this.events[id]?copy(this.events[id]):null;}
    insert(body) {if(this.events[body.id])return this.get(body.id);this.events[body.id]=Object.assign(copy(body),{status:'confirmed',conferenceData:{createRequest:{status:{statusCode:'pending'}}}});this.save(this.events);return this.get(body.id);}
    update(id,body) {need(this.events[id]&&this.events[id].status!=='cancelled','Calendar event was removed. Review it before continuing.','MISSING_EVENT');this.events[id]=Object.assign(this.events[id],copy(body));this.save(this.events);return this.get(id);}
    remove(id) {if(this.events[id]){this.events[id].status='cancelled';this.save(this.events);} }
  }
  class Engine {
    constructor(repo,calendar,options) {this.repo=repo;this.calendar=calendar;this.options=options||{};this.now=this.options.now||(()=>new Date().toISOString());this.uuid=this.options.uuid||(()=>hash(this.now()+Math.random()));}
    stamp(row,old) {return Object.assign(row,{created_at:old&&old.created_at||this.now(),updated_at:this.now()});}
    get(t,id) {const r=this.repo.all(t).find(x=>x[IDS[t]]===id);need(r,'Record was not found.','NOT_FOUND');return r;}
    snapshot() {return {students:this.repo.all('Students'),schedules:this.repo.all('RecurringSchedules'),lessons:this.repo.all('Lessons'),logs:this.repo.all('AutomationLogs').sort((a,b)=>b.execution_datetime.localeCompare(a.execution_datetime)),settings:this.repo.settings(),mode:this.calendar.mode,now:this.now()};}
    saveStudent(input) {
      const old=input.student_id?this.get('Students',input.student_id):null;
      const row=this.stamp({student_id:old?old.student_id:this.uuid(),full_name:text(input.full_name,120),email:email(input.email),timezone:zone(input.timezone),status:input.status||'Active',english_level:text(input.english_level,50),phone:text(input.phone,60),learning_goals:text(input.learning_goals),notes:text(input.notes),profile_picture:text(input.profile_picture,500),start_date:input.start_date?date(input.start_date):'',hourly_rate:input.hourly_rate===''||input.hourly_rate==null?'':Number(input.hourly_rate),currency:text(input.currency||'USD',3).toUpperCase()},old);
      need(row.full_name,'Full name is required.');need(['Active','Paused','Inactive'].includes(row.status),'Invalid student status.');need(row.hourly_rate===''||(Number.isFinite(row.hourly_rate)&&row.hourly_rate>=0),'Hourly rate must be positive.');need(/^[A-Z]{3}$/.test(row.currency),'Use a three-letter currency.');
      const future=old?this.repo.all('Lessons').filter(l=>l.student_id===old.student_id&&['Scheduled','Rescheduled'].includes(l.lesson_status)&&l.start_datetime>this.now()):[];
      if(old&&old.status!==row.status&&row.status!=='Active'&&future.length)need(['retain','cancel'].includes(input.future_policy),'Choose whether to retain or cancel existing future lessons.','FUTURE_POLICY');
      this.repo.put('Students',row);
      const results=[];
      if(old&&old.status!==row.status&&row.status!=='Active'&&input.future_policy==='cancel') future.forEach(l=>{try{this.cancel(l.lesson_id);results.push({lesson_id:l.lesson_id,status:'Cancelled'});}catch(e){results.push({lesson_id:l.lesson_id,status:'Failed',code:e.code||'SERVICE'});}});
      return {student:row,future_results:results};
    }
    saveSchedule(input) {
      const old=input.schedule_id?this.get('RecurringSchedules',input.schedule_id):null,student=this.get('Students',input.student_id);
      if(old)need(old.student_id===student.student_id,'A recurring schedule cannot change student.');
      const row=this.stamp({schedule_id:old?old.schedule_id:this.uuid(),student_id:student.student_id,day_of_week:integer(input.day_of_week,0,6),start_time:text(input.start_time,5),duration_minutes:integer(input.duration_minutes,15,240),timezone:zone(input.timezone||student.timezone),recurrence_frequency:integer(input.recurrence_frequency||1,1,4),effective_start_date:date(input.effective_start_date),effective_end_date:input.effective_end_date?date(input.effective_end_date):'',status:input.status||'Active',dst_fold:input.dst_fold==='later'?'later':'earlier'},old);
      need(/^([01]\d|2[0-3]):[0-5]\d$/.test(row.start_time),'Choose a valid start time.');need(!row.effective_end_date||row.effective_end_date>=row.effective_start_date,'End date must follow the start date.');need(['Active','Paused'].includes(row.status),'Invalid schedule status.');
      this.repo.put('RecurringSchedules',row);return row;
    }
    makeLesson(student,slot,d,start,duration,tz,key) {
      return this.stamp({lesson_id:key?hash(key):this.uuid(),occurrence_key:key||('once:'+this.uuid()),schedule_id:slot?slot.schedule_id:'',student_id:student.student_id,student_name:student.full_name,student_email:student.email,original_scheduled_start:start,start_datetime:start,end_datetime:new Date(Date.parse(start)+duration*60000).toISOString(),duration_minutes:duration,timezone:tz,google_calendar_event_id:'',google_meet_url:'',calendar_id:this.repo.settings().calendar_id,calendar_event_url:'',lesson_status:'Scheduled',sync_status:'Not Synced',conference_status:'Pending',invitation_status:'Not Requested',attendee_response_status:'Needs Action',lesson_notes:'',integration_mode:this.calendar.mode,conference_attempt:0,change_history:[],pending_action:'create',last_error:'',revision:1});
    }
    range(requested) {const s=this.repo.settings(),r=requested||nextWeek(this.now(),s.timezone,s.generation_weeks);date(r.start);date(r.end);need(r.end>=r.start&&Date.parse(r.end)-Date.parse(r.start)<=27*86400000,'Generate between one and 28 days.');need(r.start>=localDate(this.now(),s.timezone),'Cannot generate historical lessons.');return r;}
    conflicts(l,exclude,busy,extra) {return this.repo.all('Lessons').filter(x=>x.lesson_id!==exclude&&x.lesson_status!=='Cancelled'&&x.sync_status!=='Conflict'&&overlap(l,x)).map(x=>({start:x.start_datetime,end:x.end_datetime,source:'Teaching lesson'})).concat((busy||[]).filter(x=>overlap(l,x)).map(x=>({start:x.start,end:x.end,source:'Calendar busy'})),(extra||[]).filter(x=>overlap(l,x)).map(x=>({start:x.start_datetime,end:x.end_datetime,source:'Planned lesson'})));}
    preview(requested) {
      const r=this.range(requested),s=this.repo.settings(),students=this.repo.all('Students'),existing=this.repo.all('Lessons'),out=[],planned=[];
      // Pad UTC bounds to cover the complete local dates in every supported timezone.
      const busy=this.calendar.busy(dayAdd(r.start,-1)+'T00:00:00Z',dayAdd(r.end,2)+'T00:00:00Z');
      this.repo.all('RecurringSchedules').filter(x=>x.status==='Active').forEach(slot=>{
        const student=students.find(x=>x.student_id===slot.student_id&&x.status==='Active');if(!student)return;
        for(let d=r.start;d<=r.end;d=dayAdd(d,1)){
          if(new Date(d+'T12:00Z').getUTCDay()!==slot.day_of_week||d<slot.effective_start_date||(slot.effective_end_date&&d>slot.effective_end_date))continue;
          // Interval weeks are anchored to the Monday of the effective start week.
          const anchor=dayAdd(slot.effective_start_date,-((new Date(slot.effective_start_date+'T12:00Z').getUTCDay()+6)%7));
          if(Math.floor((Date.parse(d)-Date.parse(anchor))/604800000)%slot.recurrence_frequency!==0)continue;
          const key=slot.schedule_id+':'+d,old=existing.find(x=>x.occurrence_key===key);
          if(old){out.push({key,date:d,student_name:student.full_name,result:'Duplicate',lesson_id:old.lesson_id});continue;}
          try{
            const start=zoned(d,slot.start_time,slot.timezone,slot.dst_fold),l=this.makeLesson(student,slot,d,start,slot.duration_minutes,slot.timezone,key);
            if(start<=this.now()){out.push({key,date:d,student_name:student.full_name,result:'Past'});continue;}
            const conflicts=this.conflicts(l,null,busy,planned);out.push({key,date:d,student_name:student.full_name,result:conflicts.length?'Conflict':'Ready',lesson:l,conflicts});if(!conflicts.length)planned.push(l);
          }catch(e){out.push({key,date:d,student_name:student.full_name,result:'Failed',code:e.code||'VALIDATION'});}
        }
      });
      return {range:r,items:out.sort((a,b)=>(a.lesson?a.lesson.start_datetime:a.date).localeCompare(b.lesson?b.lesson.start_datetime:b.date)),mode:this.calendar.mode};
    }
    generate(requested,trigger) {
      const began=Date.now(),r=this.range(requested),log={execution_id:this.uuid(),execution_datetime:this.now(),trigger_type:trigger||'Manual',target_start_date:r.start,target_end_date:r.end,total_lessons:0,successful_lessons:0,skipped_lessons:0,conflicting_lessons:0,failed_lessons:0,execution_status:'Failed',error_details:[],duration_ms:0};
      this.repo.put('AutomationLogs',log);
      try{
        const preview=this.preview(r);log.total_lessons=preview.items.length;
        let halted=false;
        preview.items.forEach(item=>{
          if(item.result==='Duplicate'||item.result==='Past'){log.skipped_lessons++;return;}
          if(item.result==='Conflict'){log.conflicting_lessons++;log.error_details.push({occurrence_key:item.key,code:'CONFLICT',conflicts:item.conflicts});return;}
          if(item.result==='Failed'||halted||(this.options.deadline&&Date.now()>this.options.deadline)){log.failed_lessons++;log.error_details.push({occurrence_key:item.key,code:halted?'HALTED':item.code||'TIME_BUDGET'});return;}
          let l=item.lesson;
          try{this.repo.put('Lessons',l);l=this.sync(l.lesson_id);if(l.sync_status==='Synced'&&l.conference_status!=='Failed')log.successful_lessons++;else{log.failed_lessons++;log.error_details.push({lesson_id:l.lesson_id,code:l.last_error||(l.conference_status==='Failed'?'MEET_FAILED':'SYNC_FAILED')});}}
          catch(e){log.failed_lessons++;log.error_details.push({lesson_id:l.lesson_id,code:e.code||'SERVICE'});if(['QUOTA','AUTH','TIME_BUDGET'].includes(e.code))halted=true;}
        });
        log.execution_status=log.failed_lessons||log.conflicting_lessons?(log.successful_lessons||log.skipped_lessons||log.conflicting_lessons?'Partial Success':'Failed'):'Success';
      }catch(e){log.failed_lessons++;log.error_details.push({code:e.code||'SERVICE'});}
      log.duration_ms=Date.now()-began;this.repo.put('AutomationLogs',log);return log;
    }
    createLesson(input) {
      const student=this.get('Students',input.student_id);need(student.status==='Active','Only active students can receive new lessons.');const tz=zone(input.timezone||student.timezone),start=zoned(date(input.date),input.start_time,tz,input.dst_fold),duration=integer(input.duration_minutes,15,240);
      need(start>this.now(),'Choose a future lesson time.');const l=this.makeLesson(student,null,input.date,start,duration,tz);
      const conflicts=this.conflicts(l,null,this.calendar.busy(l.start_datetime,l.end_datetime));need(!conflicts.length,conflictMessage(conflicts,tz),'CONFLICT');
      this.repo.put('Lessons',l);return this.sync(l.lesson_id);
    }
    verifyEvent(l,event) {need(event&&event.extendedProperties&&event.extendedProperties.private&&event.extendedProperties.private.lesson_id===l.lesson_id&&event.extendedProperties.private.application==='teaching-scheduler','Calendar identity does not match this lesson. Review the event.','IDENTITY');}
    verifyWritableEvent(l,event) {this.verifyEvent(l,event);need(event.attendees&&event.attendees.length===1&&String(event.attendees[0].email).toLowerCase()===l.student_email.toLowerCase(),'The Calendar guest list was changed. Resolve it in Calendar before requesting notifications.','ATTENDEE_MISMATCH');}
    applyEvent(l,e) {
      this.verifyEvent(l,e);l.google_calendar_event_id=e.id;l.calendar_event_url=e.htmlLink||'';
      if(e.status==='cancelled'){l.sync_status='Failed';l.last_error='EXTERNALLY_CANCELLED';return l;}
      const attendees=e.attendees||[];if(attendees.length!==1||String(attendees[0].email).toLowerCase()!==l.student_email.toLowerCase()){l.sync_status='Failed';l.last_error='ATTENDEE_MISMATCH';return l;}
      if(Date.parse(e.start&&e.start.dateTime)!==Date.parse(l.start_datetime)||Date.parse(e.end&&e.end.dateTime)!==Date.parse(l.end_datetime)){l.sync_status='Conflict';l.last_error='EXTERNAL_CHANGE';return l;}
      const url=e.hangoutLink||(e.conferenceData&&e.conferenceData.entryPoints||[]).filter(x=>x.entryPointType==='video').map(x=>x.uri)[0];
      l.google_meet_url=url&&/^https:\/\/meet\.google\.com\/[a-z-]+$/i.test(url)?url:'';
      const conference=e.conferenceData&&e.conferenceData.createRequest&&e.conferenceData.createRequest.status;
      l.conference_status=l.google_meet_url?'Ready':conference&&conference.statusCode==='failure'?'Failed':'Pending';
      l.attendee_response_status=({'needsAction':'Needs Action','accepted':'Accepted','declined':'Declined','tentative':'Tentative'})[attendees[0].responseStatus]||'Needs Action';
      l.sync_status='Synced';l.last_error='';return l;
    }
    sync(id,retryConference) {
      let l=this.get('Lessons',id);need(l.integration_mode===this.calendar.mode,'Development lessons cannot be synchronized to Google. Create a new live lesson.','MODE');
      if(['Completed','Student Absent','Teacher Absent'].includes(l.lesson_status))return this.reconcile(id);
      try{
        const eid=l.google_calendar_event_id||eventId(l),e=this.calendar.get(eid,l.calendar_id);
        if(l.pending_action==='cancel'||l.lesson_status==='Cancelled'){
          if(e&&e.status!=='cancelled'){this.verifyWritableEvent(l,e);this.calendar.remove(eid,l.calendar_id);l.invitation_status=this.calendar.mode==='mock'?'Simulated':'Cancellation Requested';}
          else if(!l.google_calendar_event_id&&!e)l.invitation_status='Not Requested';
          l.sync_status='Synced';l.pending_action='';l.last_error='';this.repo.put('Lessons',this.stamp(l,l));return l;
        }
        if(!e&&l.google_calendar_event_id)fail('Calendar event is missing. Review it; it will not be recreated.','MISSING_EVENT');
        if(e){
          this.verifyEvent(l,e);need(e.status!=='cancelled','Calendar event was cancelled externally. Review the lesson.','EXTERNALLY_CANCELLED');
          if(l.pending_action==='reschedule'){
            this.verifyWritableEvent(l,e);
            const conflicts=this.conflicts(l,l.lesson_id,this.calendar.busy(l.start_datetime,l.end_datetime,eid,l.calendar_id));need(!conflicts.length,conflictMessage(conflicts,l.timezone),'CONFLICT');
            const body=eventBody(l,this.repo.settings());delete body.id;delete body.conferenceData;
            const updated=this.calendar.update(eid,body,l.calendar_id);l=this.applyEvent(l,updated);l.invitation_status=this.calendar.mode==='mock'?'Simulated':'Update Requested';
          }else if(retryConference&&l.conference_status==='Failed'){
            this.verifyWritableEvent(l,e);
            l.conference_attempt++;this.repo.put('Lessons',l);const body={conferenceData:eventBody(l,this.repo.settings(),l.conference_attempt).conferenceData};l=this.applyEvent(l,this.calendar.update(eid,body,l.calendar_id));
          }else {l=this.applyEvent(l,e);if(l.pending_action==='create'&&l.invitation_status==='Not Requested')l.invitation_status=this.calendar.mode==='mock'?'Simulated':'Request Unconfirmed';}
        }else{
          const conflicts=this.conflicts(l,l.lesson_id,this.calendar.busy(l.start_datetime,l.end_datetime,eid,l.calendar_id));need(!conflicts.length,conflictMessage(conflicts,l.timezone),'CONFLICT');
          const created=this.calendar.insert(eventBody(l,this.repo.settings()),l.calendar_id);l=this.applyEvent(l,created);l.invitation_status=this.calendar.mode==='mock'?'Simulated':'Requested';
          if(l.conference_status==='Pending'&&this.calendar.poll)l=this.applyEvent(l,this.calendar.poll(created.id,l.calendar_id,created));
        }
        if(l.sync_status==='Synced')l.pending_action='';
        this.repo.put('Lessons',this.stamp(l,l));return l;
      }catch(e){l.sync_status=e.code==='CONFLICT'?'Conflict':'Failed';l.last_error=e.code||'SERVICE';this.repo.put('Lessons',this.stamp(l,l));throw e;}
    }
    reconcile(id) {
      let l=this.get('Lessons',id);need(l.integration_mode===this.calendar.mode,'Lesson belongs to another integration mode.','MODE');
      if(!l.google_calendar_event_id)return l;
      try{const e=this.calendar.get(l.google_calendar_event_id,l.calendar_id);if(!e){l.sync_status='Failed';l.last_error='MISSING_EVENT';}else l=this.applyEvent(l,e);this.repo.put('Lessons',this.stamp(l,l));return l;}
      catch(e){l.sync_status='Failed';l.last_error=e.code||'SERVICE';this.repo.put('Lessons',l);throw e;}
    }
    reconcileAll() {const results=[];for(const l of this.repo.all('Lessons').filter(l=>l.integration_mode===this.calendar.mode&&l.lesson_status!=='Cancelled'&&l.google_calendar_event_id)){if(this.options.deadline&&Date.now()>this.options.deadline)break;try{results.push(this.reconcile(l.lesson_id));}catch(e){if(['QUOTA','AUTH'].includes(e.code))throw e;}}return results;}
    reschedule(input) {
      let l=this.get('Lessons',input.lesson_id);need(['Scheduled','Rescheduled'].includes(l.lesson_status),'Only upcoming, active lessons can be rescheduled.');need(l.revision===Number(input.revision),'Lesson changed in another window. Refresh and try again.','STALE');
      const tz=zone(input.timezone||l.timezone),start=zoned(date(input.date),input.start_time,tz,input.dst_fold),duration=integer(input.duration_minutes,15,240);need(start>this.now(),'Choose a future lesson time.');
      const next=Object.assign(copy(l),{start_datetime:start,end_datetime:new Date(Date.parse(start)+duration*60000).toISOString(),duration_minutes:duration,timezone:tz});
      const conflicts=this.conflicts(next,l.lesson_id,this.calendar.busy(next.start_datetime,next.end_datetime,l.google_calendar_event_id,l.calendar_id));need(!conflicts.length,conflictMessage(conflicts,tz),'CONFLICT');
      next.change_history.push({at:this.now(),original_start:l.start_datetime,original_end:l.end_datetime,start:next.start_datetime,end:next.end_datetime});next.lesson_status='Rescheduled';next.sync_status='Pending';next.pending_action='reschedule';next.revision++;this.repo.put('Lessons',this.stamp(next,l));return this.sync(l.lesson_id);
    }
    cancel(id) {let l=this.get('Lessons',id);need(!['Completed','Student Absent','Teacher Absent'].includes(l.lesson_status),'Attendance history cannot be cancelled.');if(l.lesson_status!=='Cancelled'){l.lesson_status='Cancelled';l.pending_action='cancel';l.sync_status='Pending';l.revision++;this.repo.put('Lessons',this.stamp(l,l));}return this.sync(id);}
    attend(input) {const l=this.get('Lessons',input.lesson_id);need(['Completed','Student Absent','Teacher Absent'].includes(input.lesson_status),'Choose an attendance status.');need(l.lesson_status!=='Cancelled','Cancelled lessons cannot have attendance.');need(l.start_datetime<=this.now(),'Attendance can be recorded after the lesson starts.');need(!l.pending_action,'Resolve pending calendar changes before attendance.');l.lesson_status=input.lesson_status;l.lesson_notes=text(input.lesson_notes,5000);l.revision++;this.repo.put('Lessons',this.stamp(l,l));return l;}
    notes(input) {const l=this.get('Lessons',input.lesson_id);l.lesson_notes=text(input.lesson_notes,5000);this.repo.put('Lessons',this.stamp(l,l));return l;}
    saveSettings(input) {
      const current=this.repo.settings(),s=Object.assign({},current);['teacher_name','teacher_email','timezone','default_duration','currency','theme','calendar_id','conflict_calendars','automation_day','automation_hour','generation_weeks','reminders_enabled','reminder_minutes'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(input,k))s[k]=input[k];});
      s.teacher_name=text(s.teacher_name,120);s.teacher_email=s.teacher_email?email(s.teacher_email):'';s.timezone=zone(s.timezone);s.default_duration=integer(s.default_duration,15,240);s.automation_day=integer(s.automation_day,0,6);s.automation_hour=integer(s.automation_hour,0,23);s.generation_weeks=integer(s.generation_weeks,1,4);need(['Light','Dark','System'].includes(s.theme),'Invalid theme.');s.currency=text(s.currency,3).toUpperCase();need(/^[A-Z]{3}$/.test(s.currency),'Use a three-letter currency.');s.calendar_id=text(s.calendar_id,300);need(s.calendar_id,'Select a teaching calendar.');need(!current.live_enabled||s.calendar_id===current.calendar_id,'Disable live operations before changing the teaching calendar.');need(Array.isArray(s.conflict_calendars)&&s.conflict_calendars.length<=20,'Choose at most 20 conflict calendars.');s.conflict_calendars=s.conflict_calendars.map(x=>text(x,300)).filter(Boolean);need(Array.isArray(s.reminder_minutes)&&s.reminder_minutes.length<=5,'Choose at most five reminders.');s.reminder_minutes=s.reminder_minutes.map(m=>integer(m,0,40320));s.reminders_enabled=s.reminders_enabled===true;s.FREE_ONLY_MODE=true;s.ALLOW_PAID_SERVICES=false;
      Object.keys(s).forEach(k=>this.repo.put('Settings',{setting_key:k,setting_value:s[k],updated_at:this.now()}));return s;
    }
  }
  return {Engine,MemoryRepo,MockCalendar,DEFAULTS,TABLES,IDS,STATUSES,copy,need,fail,email,zone,date,integer,dayAdd,localDate,parts,zoned,nextWeek,overlap,hash,eventId,eventBody};
});
