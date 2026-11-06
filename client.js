/**
 * 重要日（Important Days）— Client 半身（浏览器）。
 *
 * 手写 ModuleLoader bundle：不打包、不引入构建步骤，除 shell 已经提供的
 * react 之外没有任何运行时依赖。向设置面板贡献一个 `settings.section` 页面：
 *
 *   设置 → 重要日
 *
 * 页面自己画控件（不 import 任何 @deepseek-ai/dsh-client-ui-*），配色只用
 * `--dsw-alias-*` 主题 token，因此明暗主题自动跟随。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-important-day',
  factory: require => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/api/important-day'

    // ── 文案 ────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        nav: '重要日',
        title: '重要日',
        subtitle: '记下生日、纪念日与节日，随时看到还有多久。数据以 Markdown 文档保存在本机。',
        add: '新增重要日',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        edit: '编辑',
        remove: '删除',
        content: '内容',
        collapse: '收起',
        titleField: '标题',
        titlePlaceholder: '例如：某人生日',
        contentField: '内容（可选）',
        contentPlaceholder: '想记下来的细节：礼物清单、约定地点、注意事项…',
        calendar: '日历',
        solar: '公历',
        lunar: '农历',
        withYear: '包含年份',
        withYearOn: '一次性日期：显示距离这一天还有多少天，或已经过去了多少天。',
        withYearOff: '每年重复：显示距离下一次还有多少天。',
        year: '年份',
        lunarYear: '农历年',
        month: '月',
        day: '日',
        leapMonth: '闰月',
        leapMonthHint: '该年没有这个闰月时，按同号平月计算。',
        lunarUnavailable: '当前运行环境的 ICU 不含中文历，农历暂不可用。',
        empty: '还没有记录。点右上角「新增重要日」加一条吧。',
        loading: '正在加载…',
        loadFailed: '无法连接插件后端',
        retry: '重试',
        todayIs: '今天',
        daysLeft: '还有 {n} 天',
        daysPassed: '已经过了 {n} 天',
        isToday: '就是今天',
        everyYear: '每年',
        once: '仅一次',
        solarShort: '公历',
        lunarShort: '农历',
        dataDir: '数据目录',
        dataDirHint: '一条重要日 = 一个 .md 文档，可以直接用编辑器打开修改。',
        note_shortMonthAdjusted: '该农历月没有这一天，已按当月最后一天计算。',
        note_leapMonthMissing: '该年没有这个闰月，已按同号平月计算。',
        note_dateAdjusted: '该年没有这个日期，已按当月最后一天计算。',
        note_unresolvable: '这个日期无法换算，请检查设置。',
        note_unavailable: '当前运行环境不含中文历，这个农历日期暂时算不出来。',
        errorTitleEmpty: '请填写标题',
        errorConflict: '这个重要日刚刚在别处被修改过了，已为你刷新，请确认后重新保存。',
        brokenTitle: '有 {n} 个文档读不出来',
        brokenHint: '这些文件格式有问题，已跳过。修好头部字段（month 1-12、day 1-31/30）后刷新即可。',
        errorGeneric: '保存失败：{detail}',
        untitled: '（未命名）',
        removeQuestion: '删除这一条？',
        monthNames: ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'],
        lunarMonthNames: ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'],
        lunarDayNames: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],
      },
      en: {
        nav: 'Important Days',
        title: 'Important Days',
        subtitle: 'Keep birthdays, anniversaries and festivals — solar or lunar — and see how long until each one. Entries live as Markdown documents on this machine.',
        add: 'New important day',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        edit: 'Edit',
        remove: 'Delete',
        content: 'Details',
        collapse: 'Collapse',
        titleField: 'Title',
        titlePlaceholder: 'e.g. Alex\u2019s birthday',
        contentField: 'Details (optional)',
        contentPlaceholder: 'Anything worth remembering — gift ideas, meeting point\u2026',
        calendar: 'Calendar',
        solar: 'Solar',
        lunar: 'Lunar',
        withYear: 'Include year',
        withYearOn: 'One-off date: shows how many days until this exact day, or how many have passed.',
        withYearOff: 'Repeats every year: shows how many days until the next occurrence.',
        year: 'Year',
        lunarYear: 'Lunar year',
        month: 'Month',
        day: 'Day',
        leapMonth: 'Leap month',
        leapMonthHint: 'If that leap month does not exist, the regular month is used.',
        lunarUnavailable: 'This runtime’s ICU has no Chinese calendar, so lunar dates are unavailable.',
        empty: 'No entries yet. Use \u201cNew important day\u201d to add one.',
        loading: 'Loading\u2026',
        loadFailed: 'Cannot reach the plugin backend',
        retry: 'Retry',
        todayIs: 'Today',
        daysLeft: '{n} days to go',
        daysPassed: '{n} days ago',
        isToday: 'Today!',
        everyYear: 'Yearly',
        once: 'One-off',
        solarShort: 'Solar',
        lunarShort: 'Lunar',
        dataDir: 'Data folder',
        dataDirHint: 'One important day = one .md document. Open it in any editor to change it.',
        note_shortMonthAdjusted: 'That lunar month has no such day, so its last day is used.',
        note_leapMonthMissing: 'That leap month does not exist this year, so the regular month is used.',
        note_dateAdjusted: 'That date does not exist this year, so the last day of the month is used.',
        note_unresolvable: 'This date cannot be resolved; please check the settings.',
        note_unavailable: 'This runtime has no Chinese calendar, so this lunar date cannot be resolved.',
        errorTitleEmpty: 'Please enter a title',
        errorConflict: 'This entry was changed elsewhere just now. The list has been refreshed; please review and save again.',
        brokenTitle: '{n} document(s) could not be read',
        brokenHint: 'Those files were skipped. Fix the header fields (month 1-12, day 1-31/30) and refresh.',
        errorGeneric: 'Save failed: {detail}',
        untitled: '(untitled)',
        removeQuestion: 'Delete this entry?',
        monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        lunarMonthNames: ['1st month', '2nd month', '3rd month', '4th month', '5th month', '6th month', '7th month', '8th month', '9th month', '10th month', '11th month', '12th month'],
        lunarDayNames: Array.from({ length: 30 }, (_, index) => `day ${index + 1}`),
      },
    }

    // ── 样式（全部走主题 token） ─────────────────────────────────────────────
    const CSS = [
      '.iday_root{width:100%;max-width:880px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);box-sizing:border-box}',
      '.iday_head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}',
      '.iday_headText{display:flex;flex-direction:column;gap:7px;min-width:0;flex:1}',
      '.iday_title{margin:0;font-size:19px;line-height:1.3;font-weight:650;color:var(--dsw-alias-label-primary)}',
      '.iday_sub{margin:0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-width:64ch}',
      '.iday_todayChip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.iday_btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;font-family:inherit;cursor:pointer;white-space:nowrap}',
      '.iday_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.iday_btn:disabled{opacity:.45;cursor:default}',
      '.iday_btnPrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-brand-text);font-weight:600}',
      '.iday_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.iday_btnDanger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.iday_btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.iday_btnSmall{padding:3px 9px;font-size:12px;border-radius:7px}',
      '.iday_card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;overflow:hidden}',
      '.iday_form{display:flex;flex-direction:column;gap:13px;padding:16px}',
      '.iday_formRow{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}',
      '.iday_field{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.iday_fieldGrow{flex:1 1 240px}',
      '.iday_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.iday_input,.iday_select,.iday_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 9px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;width:100%}',
      '.iday_input:focus,.iday_select:focus,.iday_textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px var(--dsw-alias-brand-primary-soft)}',
      '.iday_textarea{resize:vertical;min-height:78px;line-height:1.6}',
      '.iday_inputYear{width:96px}',
      '.iday_select{min-width:96px;width:auto}',
      '.iday_segment{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
      '.iday_segmentBtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 14px;font-size:13px;font-family:inherit;cursor:pointer}',
      '.iday_segmentBtn[data-on="true"]{background:var(--dsw-alias-brand-primary-soft);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.iday_switchRow{display:flex;align-items:center;gap:9px;cursor:pointer;user-select:none}',
      '.iday_switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:0;cursor:pointer}',
      '.iday_switch[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent}',
      '.iday_knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s ease}',
      '.iday_switch[data-on="true"] .iday_knob{left:16px}',
      '.iday_hint{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.iday_formFoot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}',
      '.iday_error{font-size:12.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary);margin:0}',
      '.iday_list{display:flex;flex-direction:column}',
      '.iday_item{display:flex;gap:14px;padding:14px 16px;align-items:flex-start}',
      '.iday_item+.iday_item{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.iday_itemMain{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}',
      '.iday_itemTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.iday_itemTitle{font-size:14px;font-weight:640;line-height:1.35;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.iday_tag{font-size:11px;line-height:1.5;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.iday_meta{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.iday_count{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px;text-align:right}',
      '.iday_badge{font-size:13px;font-weight:660;white-space:nowrap;padding:4px 10px;border-radius:9px;border:1px solid transparent}',
      '.iday_badgeFuture{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}',
      '.iday_badgeToday{color:var(--dsw-alias-brand-text);background:var(--dsw-alias-button-primary-fill)}',
      '.iday_badgePast{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}',
      '.iday_badgeInvalid{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}',
      '.iday_itemAction{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}',
      '.iday_note{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-warn-primary);margin:0}',
      '.iday_body{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:2px 0 0;max-height:14em;overflow:auto;padding-right:4px}',
      '.iday_more{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-family:inherit;cursor:pointer;padding:0;text-decoration:underline;align-self:flex-start}',
      '.iday_empty{padding:34px 18px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}',
      '.iday_emptyText{font-size:13px;color:var(--dsw-alias-label-tertiary);margin:0;overflow-wrap:anywhere}',
      '.iday_foot{display:flex;flex-direction:column;gap:4px;padding:0 2px}',
      '.iday_footLabel{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-tertiary)}',
      '.iday_footPath{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.iday_broken{border-color:var(--dsw-alias-state-warn-primary);padding:12px 16px;display:flex;flex-direction:column;gap:6px}',
      '.iday_brokenTitle{margin:0;font-size:13px;font-weight:640;color:var(--dsw-alias-state-warn-primary)}',
      '.iday_brokenList{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:2px}',
      '.iday_brokenFile{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}',
      '.iday_confirm{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap;justify-content:flex-end}',
      '@media (max-width:560px){.iday_item{flex-wrap:wrap}.iday_count{align-items:flex-start;text-align:left;width:100%}}',
    ].join('\n')

    // ── 语言 ────────────────────────────────────────────────────────────────
    // 优先读真实 locale 服务的活动语言；服务缺失时退回 <html lang>，再退回
    // Intl 的默认 locale。translate() 每次调用都会现读，所以切换语言后已挂载
    // 的页面只需要一次重渲染（LocaleBoundPage 负责）就能整体换文案。
    let localeFace = null

    function localeOf() {
      try {
        const active = localeFace?.getSnapshot?.()?.active
        if (typeof active === 'string' && active !== '') return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch { /* 忽略 */ }
      try {
        const lang = typeof document !== 'undefined' ? String(document.documentElement.lang || '').toLowerCase() : ''
        if (lang.startsWith('zh')) return 'zh'
        if (lang !== '') return 'en'
      } catch { /* 忽略 */ }
      try {
        const tag = String(Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase()
        return tag.startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'zh'
      }
    }

    function translate(key, values) {
      const dict = DICT[localeOf()] || DICT.zh
      const template = key in dict ? dict[key] : (key in DICT.zh ? DICT.zh[key] : key)
      if (Array.isArray(template)) return template
      return String(template).replace(/\{(\w+)\}/g, (whole, name) => (values && name in values ? String(values[name]) : whole))
    }

    function pickLocalized(value) {
      if (value === null || value === undefined) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object') return value[localeOf()] || value.zh || value.en || ''
      return String(value)
    }

    // ── 接口 ────────────────────────────────────────────────────────────────
    async function callApi(pathname, options) {
      const init = { credentials: 'same-origin', ...(options || {}) }
      if (init.body !== undefined && typeof init.body !== 'string') {
        init.body = JSON.stringify(init.body)
        init.headers = { 'content-type': 'application/json', ...(init.headers || {}) }
      }
      const response = await fetch(API + pathname, init)
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        const detail = payload && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status
        const error = new Error(detail)
        error.status = response.status
        throw error
      }
      return payload
    }

    function blankDraft(today) {
      const now = new Date()
      return {
        id: '',
        title: '',
        content: '',
        calendar: 'solar',
        withYear: false,
        year: now.getFullYear(),
        month: today ? Number(String(today.date).slice(5, 7)) : now.getMonth() + 1,
        day: today ? Number(String(today.date).slice(8, 10)) : now.getDate(),
        leap: false,
        expectedRev: 0,
      }
    }

    /**
     * 草稿的"日"上限：农历固定 30；公历含年份按该年该月实际天数；不含年份时
     * 按闰年算（让 2 月 29 日可选，平年由后端回落并标注）。必须与 Host 端
     * index.js 的 maxDay 校验保持一致，否则会出现"能选但保存被拒"。
     */
    function dayMaxOf(draft) {
      if (draft.calendar === 'lunar') return 30
      const month = Number(draft.month)
      if (!(month >= 1 && month <= 12)) return 31
      const year = draft.withYear === true ? Number(draft.year) : 2028
      if (!Number.isInteger(year) || year < 1900 || year > 2200) return 31
      return new Date(Date.UTC(year, month, 0)).getUTCDate()
    }

    function draftOf(item) {
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        calendar: item.calendar,
        withYear: item.withYear === true,
        year: item.withYear === true && Number(item.year) > 0 ? Number(item.year) : new Date().getFullYear(),
        month: Number(item.month),
        day: Number(item.day),
        leap: item.leap === true,
        // 编辑时看到的版本号：保存时回传给后端做乐观并发校验，
        // 若这期间文件被别处改过，后端会返回 409 而不是静默覆盖。
        expectedRev: Number.isInteger(item.rev) ? item.rev : 0,
      }
    }

    // ── 页面 ────────────────────────────────────────────────────────────────
    function SettingsPage() {
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [pendingDelete, setPendingDelete] = useState('')
      const [expanded, setExpanded] = useState('')
      const [status, setStatus] = useState('loading')
      const [data, setData] = useState(null)
      const [loadError, setLoadError] = useState('')

      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        let alive = true
        const load = async () => {
          try {
            const payload = await callApi('/list')
            if (!alive) return
            setData(payload)
            setStatus('ready')
            setLoadError('')
          } catch (failure) {
            if (!alive) return
            setLoadError(String(failure && failure.message ? failure.message : failure))
            setStatus('failed')
          }
        }
        void load()
        const onVisible = () => {
          if (typeof document === 'undefined') return
          if (document.visibilityState !== 'hidden') void load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      const reload = useCallback(async () => {
        try {
          const payload = await callApi('/list')
          setData(payload)
          setStatus('ready')
          setLoadError('')
        } catch (failure) {
          setLoadError(String(failure && failure.message ? failure.message : failure))
          setStatus('failed')
        }
      }, [])

      /** 刷新列表并把最新数据交回调用方（冲突后同步版本号用）。 */
      const refreshAndReturn = useCallback(async () => {
        try {
          const payload = await callApi('/list')
          setData(payload)
          setStatus('ready')
          setLoadError('')
          return payload
        } catch (failure) {
          setLoadError(String(failure && failure.message ? failure.message : failure))
          setStatus('failed')
          return null
        }
      }, [])

      const today = data ? data.today : null
      const items = data && Array.isArray(data.items) ? data.items : []

      // 切换日历 / 月份 / 年份时把"日"夹回合法范围，避免出现"31 日 + 2 月"
      // 这种前端选了、后端必拒的组合。
      const patchDraft = patch => setDraft(current => {
        if (current === null) return current
        const next = { ...current, ...patch }
        next.day = Math.min(Number(next.day), dayMaxOf(next))
        return next
      })

      const submit = async () => {
        if (draft === null) return
        if (draft.title.trim() === '') {
          setError(translate('errorTitleEmpty'))
          return
        }
        setBusy(true)
        setError('')
        try {
          await callApi('/save', {
            method: 'POST',
            body: {
              id: draft.id === '' ? undefined : draft.id,
              title: draft.title,
              content: draft.content,
              calendar: draft.calendar,
              withYear: draft.withYear === true,
              year: draft.withYear === true ? Number(draft.year) : 0,
              month: Number(draft.month),
              day: Number(draft.day),
              leap: draft.calendar === 'lunar' && draft.leap === true,
              expectedRev: Number.isInteger(draft.expectedRev) ? draft.expectedRev : undefined,
            },
          })
          setDraft(null)
          await reload()
        } catch (failure) {
          if (failure && failure.status === 409) {
            setError(translate('errorConflict'))
            // 把刷新后的 rev 写回草稿：否则用户再点一次保存仍带着旧版本号，
            // 会立刻再撞一次 409。
            const latest = await refreshAndReturn()
            if (latest !== null && draft !== null) {
              const current = latest.items.find(entry => entry.id === draft.id)
              if (current !== undefined) patchDraft({ expectedRev: Number(current.rev) })
            }
          } else {
            setError(translate('errorGeneric', { detail: failure && failure.message ? failure.message : String(failure) }))
          }
        } finally {
          setBusy(false)
        }
      }

      const confirmRemove = async id => {
        setBusy(true)
        setError('')
        try {
          await callApi('/remove', { method: 'POST', body: { id } })
          setPendingDelete('')
          await reload()
        } catch (failure) {
          setError(translate('errorGeneric', { detail: failure && failure.message ? failure.message : String(failure) }))
        } finally {
          setBusy(false)
        }
      }

      function renderItem(item) {
        const phase = item.phase
        const badgeClass = phase === 'today'
          ? 'iday_badge iday_badgeToday'
          : phase === 'past'
            ? 'iday_badge iday_badgePast'
            : phase === 'future'
              ? 'iday_badge iday_badgeFuture'
              : 'iday_badge iday_badgeInvalid'
        const badgeText = phase === 'today'
          ? translate('isToday')
          : phase === 'future'
            ? translate('daysLeft', { n: item.days })
            : phase === 'past'
              ? translate('daysPassed', { n: item.days })
              : translate(item.note === 'unavailable' ? 'note_unavailable' : 'note_unresolvable')
        const calendarTag = item.calendar === 'lunar' ? translate('lunarShort') : translate('solarShort')
        const repeatTag = item.withYear ? translate('once') : translate('everyYear')
        const isExpanded = expanded === item.id
        const confirming = pendingDelete === item.id
        const content = typeof item.content === 'string' ? item.content : ''
        const noteKey = item.note ? 'note_' + item.note : ''
        const metaParts = [pickLocalized(item.source), pickLocalized(item.solar)]
        if (item.withYear && Number(item.year) > 0) metaParts.push(String(item.year))

        const actionButtons = confirming
          ? h('div', { className: 'iday_confirm' },
            h('span', null, translate('removeQuestion')),
            h('button', {
              type: 'button',
              className: 'iday_btn iday_btnSmall iday_btnDanger',
              disabled: busy,
              onClick: () => void confirmRemove(item.id),
            }, translate('remove')),
            h('button', {
              type: 'button',
              className: 'iday_btn iday_btnSmall',
              disabled: busy,
              onClick: () => setPendingDelete(''),
            }, translate('cancel')))
          : h('div', { className: 'iday_itemAction' },
            h('button', {
              type: 'button',
              className: 'iday_btn iday_btnSmall',
              disabled: busy || draft !== null,
              onClick: () => {
                setError('')
                setPendingDelete('')
                setDraft(draftOf(item))
              },
            }, translate('edit')),
            h('button', {
              type: 'button',
              className: 'iday_btn iday_btnSmall',
              disabled: busy || draft !== null,
              onClick: () => setPendingDelete(item.id),
            }, translate('remove')))

        const contentBlock = content === ''
          ? null
          : isExpanded
            ? h('div', null,
              h('p', { className: 'iday_body' }, content),
              h('button', {
                type: 'button',
                className: 'iday_more',
                onClick: () => setExpanded(''),
              }, translate('collapse')))
            : h('button', {
              type: 'button',
              className: 'iday_more',
              onClick: () => setExpanded(item.id),
            }, translate('content') + '…')

        return h('div', { className: 'iday_item', key: item.id },
          h('div', { className: 'iday_itemMain' },
            h('div', { className: 'iday_itemTop' },
              h('span', { className: 'iday_itemTitle' }, item.title === '' ? translate('untitled') : item.title),
              h('span', { className: 'iday_tag' }, calendarTag),
              h('span', { className: 'iday_tag' }, repeatTag)),
            h('div', { className: 'iday_meta' }, metaParts.join(' · ')),
            noteKey === '' ? null : h('p', { className: 'iday_note' }, translate(noteKey)),
            contentBlock),
          h('div', { className: 'iday_count' },
            h('span', { className: badgeClass }, badgeText),
            actionButtons))
      }

      function renderForm() {
        const isLunar = draft.calendar === 'lunar'
        // small-icu 环境下后端会报告 lunarAvailable=false：禁用农历选项并说明原因，
        // 而不是让用户填完再被保存拒绝。
        const lunarReady = data === null || data.lunarAvailable !== false
        const monthNames = translate(isLunar ? 'lunarMonthNames' : 'monthNames')
        const dayNames = isLunar ? translate('lunarDayNames') : null
        const monthOptions = []
        for (let m = 1; m <= 12; m += 1) {
          monthOptions.push(h('option', { value: String(m), key: 'm' + m },
            Array.isArray(monthNames) && monthNames[m - 1] !== undefined ? monthNames[m - 1] : String(m)))
        }
        const dayMax = dayMaxOf(draft)
        const dayOptions = []
        for (let d = 1; d <= dayMax; d += 1) {
          dayOptions.push(h('option', { value: String(d), key: 'd' + d },
            Array.isArray(dayNames) && dayNames[d - 1] !== undefined ? dayNames[d - 1] : String(d)))
        }
        const dayValue = String(Math.min(Number(draft.day), dayMax))

        return h('div', { className: 'iday_card' },
          h('div', { className: 'iday_form' },
            h('div', { className: 'iday_formRow' },
              h('div', { className: 'iday_field' },
                h('span', { className: 'iday_label' }, translate('calendar')),
                h('div', { className: 'iday_segment', role: 'group' },
                  h('button', {
                    type: 'button',
                    className: 'iday_segmentBtn',
                    'data-on': String(!isLunar),
                    onClick: () => patchDraft({ calendar: 'solar' }),
                  }, translate('solar')),
                  h('button', {
                    type: 'button',
                    className: 'iday_segmentBtn',
                    'data-on': String(isLunar),
                    disabled: !lunarReady,
                    title: lunarReady ? undefined : translate('lunarUnavailable'),
                    onClick: () => { if (lunarReady) patchDraft({ calendar: 'lunar' }) },
                  }, translate('lunar')))),
              draft.withYear
                ? h('div', { className: 'iday_field' },
                  h('span', { className: 'iday_label' }, translate(isLunar ? 'lunarYear' : 'year')),
                  h('input', {
                    className: 'iday_input iday_inputYear',
                    type: 'number',
                    min: 1900,
                    max: 2200,
                    value: String(draft.year),
                    onChange: event => patchDraft({ year: Number(event.target.value) }),
                  }))
                : null,
              h('div', { className: 'iday_field' },
                h('span', { className: 'iday_label' }, translate('month')),
                h('select', {
                  className: 'iday_select',
                  value: String(draft.month),
                  onChange: event => patchDraft({ month: Number(event.target.value) }),
                }, monthOptions)),
              h('div', { className: 'iday_field' },
                h('span', { className: 'iday_label' }, translate('day')),
                h('select', {
                  className: 'iday_select',
                  value: dayValue,
                  onChange: event => patchDraft({ day: Number(event.target.value) }),
                }, dayOptions))),
            isLunar
              ? h('div', { className: 'iday_formRow' },
                h('div', { className: 'iday_field' },
                  h('span', { className: 'iday_label' }, translate('leapMonth')),
                  h('label', { className: 'iday_switchRow' },
                    h('button', {
                      type: 'button',
                      role: 'switch',
                      'aria-checked': String(draft.leap === true),
                      className: 'iday_switch',
                      'data-on': String(draft.leap === true),
                      onClick: () => patchDraft({ leap: draft.leap !== true }),
                    }, h('span', { className: 'iday_knob' })))))
              : null,
            h('div', { className: 'iday_formRow' },
              h('label', { className: 'iday_switchRow' },
                h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': String(draft.withYear === true),
                  className: 'iday_switch',
                  'data-on': String(draft.withYear === true),
                  onClick: () => patchDraft({ withYear: draft.withYear !== true }),
                }, h('span', { className: 'iday_knob' })),
                h('span', { className: 'iday_label' }, translate('withYear')))),
            h('p', { className: 'iday_hint' }, draft.withYear ? translate('withYearOn') : translate('withYearOff')),
            isLunar && draft.leap ? h('p', { className: 'iday_hint' }, translate('leapMonthHint')) : null,
            h('div', { className: 'iday_field iday_fieldGrow' },
              h('span', { className: 'iday_label' }, translate('titleField')),
              h('input', {
                className: 'iday_input',
                type: 'text',
                maxLength: 200,
                placeholder: translate('titlePlaceholder'),
                value: draft.title,
                onChange: event => patchDraft({ title: event.target.value }),
              })),
            h('div', { className: 'iday_field iday_fieldGrow' },
              h('span', { className: 'iday_label' }, translate('contentField')),
              h('textarea', {
                className: 'iday_textarea',
                placeholder: translate('contentPlaceholder'),
                value: draft.content,
                onChange: event => patchDraft({ content: event.target.value }),
              })),
            error === '' ? null : h('p', { className: 'iday_error' }, error),
            h('div', { className: 'iday_formFoot' },
              h('button', {
                type: 'button',
                className: 'iday_btn iday_btnPrimary',
                disabled: busy,
                onClick: () => void submit(),
              }, busy ? translate('saving') : translate('save')),
              h('button', {
                type: 'button',
                className: 'iday_btn',
                disabled: busy,
                onClick: () => {
                  setDraft(null)
                  setError('')
                },
              }, translate('cancel')))))
      }

      let listBody
      if (status === 'loading') {
        listBody = h('div', { className: 'iday_card iday_empty' },
          h('p', { className: 'iday_emptyText' }, translate('loading')))
      } else if (status === 'failed') {
        listBody = h('div', { className: 'iday_card iday_empty' },
          h('p', { className: 'iday_emptyText' }, translate('loadFailed') + '：' + loadError),
          h('button', { type: 'button', className: 'iday_btn', onClick: () => void reload() }, translate('retry')))
      } else if (items.length === 0) {
        listBody = h('div', { className: 'iday_card iday_empty' },
          h('p', { className: 'iday_emptyText' }, translate('empty')))
      } else {
        listBody = h('div', { className: 'iday_card' },
          h('div', { className: 'iday_list' }, items.map(renderItem)))
      }

      const header = h('div', { className: 'iday_head' },
        h('div', { className: 'iday_headText' },
          h('h2', { className: 'iday_title' }, translate('title')),
          h('p', { className: 'iday_sub' }, translate('subtitle')),
          today === null
            ? null
            : h('div', null,
              h('span', { className: 'iday_todayChip' },
                translate('todayIs') + ' · ' + today.date + ' · ' + today.lunar))),
        h('button', {
          type: 'button',
          className: 'iday_btn iday_btnPrimary',
          disabled: busy || draft !== null || status === 'loading',
          onClick: () => {
            setError('')
            setDraft(blankDraft(today))
          },
        }, translate('add')))

      const brokenList = data && Array.isArray(data.broken) ? data.broken : []
      const brokenBanner = brokenList.length === 0
        ? null
        : h('div', { className: 'iday_card iday_broken' },
          h('p', { className: 'iday_brokenTitle' }, translate('brokenTitle', { n: brokenList.length })),
          h('p', { className: 'iday_hint' }, translate('brokenHint')),
          h('ul', { className: 'iday_brokenList' },
            brokenList.map(entry => h('li', { key: entry.file, className: 'iday_brokenFile' }, entry.file))))

      const footer = data === null
        ? null
        : h('div', { className: 'iday_foot' },
          h('span', { className: 'iday_footLabel' }, translate('dataDir')),
          h('span', { className: 'iday_footPath' }, data.dataDir),
          h('span', { className: 'iday_footLabel' }, translate('dataDirHint')))

      return h('div', { className: 'iday_root' },
        header,
        draft === null ? null : renderForm(),
        draft === null && error !== '' ? h('p', { className: 'iday_error' }, error) : null,
        brokenBanner,
        listBody,
        footer)
    }

    // 语言变化时强制重渲染：`label` 是 thunk，shell 每次投影都会重新读；已挂载
    // 的页面实例则靠这里订阅 ctx.locale 后重新渲染。translate() 每次调用现读
    // localeOf()（优先读 locale 服务快照，回落到 <html lang>），因此重渲染即可换文案。
    function LocaleBoundPage(props) {
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        if (typeof props.subscribeLocale !== 'function') return undefined
        return props.subscribeLocale(() => setRevision(value => value + 1))
      }, [props.subscribeLocale])
      void revision
      return h(SettingsPage, null)
    }

    function apply(ctx) {
      // 用 effect 持有 locale face：HMR 重新 apply 或插件卸载时能干净复位，
      // 不会把上一个实例的 face 残留给下一个。
      ctx.effect(() => {
        try {
          if (ctx.locale !== undefined) localeFace = ctx.locale
        } catch { /* 服务缺失时退回 document.lang */ }
        return () => { localeFace = null }
      }, 'important-day: locale face')

      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-important-day')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'important-day: styles')

      const subscribeLocale = callback => {
        try {
          if (typeof ctx.locale?.subscribe === 'function') return ctx.locale.subscribe(callback)
        } catch { /* 服务缺失时退化为不订阅 */ }
        return () => {}
      }

      const Page = props => h(LocaleBoundPage, { ...props, subscribeLocale })

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'important-day',
        order: 50,
        // label 是 thunk：每次投影都重新读，所以语言切换后导航名自动跟着换。
        label: () => translate('nav'),
      }, Page))
    }

    return { name: 'important-day', inject: ['slots', 'locale'], apply }
  },
})
