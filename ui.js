// --- UI HELPERS & RENDERERS ---

/**
 * Converts a number to its Persian equivalent string.
 * @param {number | string} num The number to convert.
 * @returns {string} The Persian string representation of the number.
 */
window.toPersian = num => num.toString().replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

// --- NEW: Flag to control the initial animation ---
let isFirstRender = true;

// --- TEMPLATES for different pages ---
const templates = {
    onboardingStep(step) { 
        return `<div class="page-enter">
                    <h2 class="text-xl font-semibold text-gray-700 text-center mb-6">${{1:'طول سیکل پریود شما؟',2:'طول دوره پریود شما؟',3:'آخرین بار کی پریود شدید؟',4:'سال تولد شما؟'}[step]}</h2>
                    ${step === 3 ? 
                        `<input type="text" id="onboarding-date-input" readonly class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg cursor-pointer" placeholder="تاریخ را انتخاب کنید" onclick="window.app.openDatePicker('onboarding-date-input')">` : 
                        `<select id="${{1:'cycle-length',2:'period-length',4:'birth-year'}[step]}" class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg"></select>`
                    }
                    <button onclick="window.app.nextStep(${step + 1})" class="w-full bg-pink-500 text-white font-bold py-3 rounded-lg mt-8">${step === 4 ? 'تأیید و ورود' : 'تأیید'}</button>
                </div>`; 
    },
    home() { 
        return `<div class="page-enter">
                    <div class="flex flex-col items-center text-center">
                        <div class="relative my-6 w-72 h-72">
                            <svg id="cycle-chart" class="w-full h-full" viewBox="0 0 200 200"></svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                                <span id="days-left" class="text-5xl font-bold text-pink-500">--</span>
                                <span id="days-unit" class="text-lg text-gray-600 leading-tight">روز دیگر</span>
                                <p id="pms-countdown" class="text-sm text-amber-600 mt-1"></p>
                            </div>
                        </div>
                        <div class="flex flex-col sm:flex-row items-center justify-center gap-3 mt-2 w-full">
                            <button onclick="window.app.logToday()" class="text-base w-full sm:w-auto text-white bg-pink-500 hover:bg-pink-600 px-5 py-2.5 rounded-full font-semibold">ثبت علائم امروز</button>
                            <button id="edit-period-btn" onclick="window.app.openEditPeriodModal()" class="text-base w-full sm:w-auto text-pink-500 hover:bg-pink-200 bg-pink-100 px-5 py-2.5 rounded-full font-semibold">ثبت زمان پریود</button>
                        </div>
                        <div id="next-period-container" class="flex items-center justify-center gap-2 mt-4 text-lg">
                            <span class="text-gray-600">تاریخ پریود بعدی:</span>
                            <p id="next-period-date" class="font-semibold text-gray-800"></p>
                        </div>
                    </div>
                    <div id="calendar-view" class="mt-8">
                        <div class="flex justify-between items-center mb-4">
                            <button onclick="window.app.changeMonth(-1)" class="p-2 rounded-full hover:bg-gray-100">&lt;</button>
                            <h3 id="calendar-month-year" class="text-lg font-bold"></h3>
                            <button onclick="window.app.changeMonth(1)" class="p-2 rounded-full hover:bg-gray-100">&gt;</button>
                        </div>
                        <div class="grid grid-cols-7 text-center text-xs text-gray-500 mb-2">${['ش','ی','د','س','چ','پ','ج'].map(d=>`<span>${d}</span>`).join('')}</div>
                        <div id="calendar-grid" class="grid grid-cols-7"></div>
                    </div>
                    <div class="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-gray-600">
                        <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" style="background-color: #fef08a;"></span><span>روزهای PMS</span></div>
                        <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" style="background-color: #fecdd3;"></span><span>روزهای پریود</span></div>
                        <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" style="background-color: #dcfce7;"></span><span>بازه باروری</span></div>
                        <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" style="background-color: #dcfce7; border: 2px dashed #3bb265;"></span><span>تخمک‌گذاری</span></div>
                    </div>
                </div>`; 
    },
    settings() { 
        return `<div class="page-enter space-y-6">
                    <div><label class="block text-gray-600 mb-2">طول سیکل پریود</label><select id="settings-cycle-length" class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg"></select></div>
                    <div><label class="block text-gray-600 mb-2">طول دوره پریود</label><select id="settings-period-length" class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg"></select></div>
                    <div><label class="block text-gray-600 mb-2">سال تولد</label><select id="settings-birth-year" class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg"></select></div>
                    <button onclick="window.app.saveSettings()" class="w-full bg-pink-500 text-white font-bold py-3 rounded-lg mt-8">ذخیره تغییرات</button>
                </div>`; 
    },
    analysis() { 
        return `<div class="page-enter space-y-6">
                    <div class="flex justify-center border-b">
                        <button data-months="1" class="analysis-tab time-tab active-tab px-4 py-2 font-semibold">۱ ماه</button>
                        <button data-months="3" class="analysis-tab time-tab px-4 py-2 font-semibold">۳ ماه</button>
                        <button data-months="6" class="analysis-tab time-tab px-4 py-2 font-semibold">۶ ماه</button>
                        <button data-months="12" class="analysis-tab time-tab px-4 py-2 font-semibold">۱ سال</button>
                    </div>
                    <div class="flex justify-center mb-4">
                        <div class="flex p-1 bg-gray-200 rounded-full text-sm">
                            <button data-phase="all" class="analysis-tab phase-tab active-tab px-4 py-1 rounded-full">کلی</button>
                            <button data-phase="pms" class="analysis-tab phase-tab px-4 py-1 rounded-full">دوره PMS</button>
                            <button data-phase="period" class="analysis-tab phase-tab px-4 py-1 rounded-full">دوره پریود</button>
                        </div>
                    </div>
                    <div id="analysis-charts" class="space-y-6"></div>
                </div>`;
    }
};

// --- PHASE CALCULATION LOGIC ---
const getPhaseInfoForDate = (date, user) => {
    // --- MODIFIED --- Handle null last_period_date
    if (!user.last_period_date) return { class: 'normal-day' };
    
    const cycleLength = user.avg_cycle_length ? Math.round(user.avg_cycle_length) : parseInt(user.cycle_length);
    const periodLength = user.avg_period_length ? Math.round(user.avg_period_length) : parseInt(user.period_length);
    const lastPeriod = moment(user.last_period_date, 'YYYY-MM-DD');

    let cycleStartDate;
    if (date.isSameOrAfter(lastPeriod, 'day')) {
        const diffDays = date.diff(lastPeriod, 'days');
        const numCycles = Math.floor(diffDays / cycleLength);
        cycleStartDate = lastPeriod.clone().add(numCycles * cycleLength, 'days');
    } else {
        const diffDays = lastPeriod.diff(date, 'days');
        const numCycles = Math.ceil(diffDays / cycleLength);
        cycleStartDate = lastPeriod.clone().subtract(numCycles * cycleLength, 'days');
    }

    const dayOfCycle = date.diff(cycleStartDate, 'days') + 1;

    const periodEndDay = periodLength;
    const ovulationDay = cycleLength - 14;
    const fertileStartDay = Math.max(1, ovulationDay - 5);
    const fertileEndDay = ovulationDay + 2;
    const pmsStartDay = cycleLength - 4;

    if (dayOfCycle >= 1 && dayOfCycle <= periodEndDay) return { class: 'period-day' };
    if (dayOfCycle >= fertileStartDay && dayOfCycle <= fertileEndDay) {
        if (dayOfCycle === ovulationDay) return { class: 'ovulation-day' };
        return { class: 'fertile-day' };
    }
    if (dayOfCycle >= pmsStartDay && dayOfCycle <= cycleLength) return { class: 'pms-day' };
    
    return { class: 'normal-day' };
};

// --- FIX START ---
const getPhaseInfoForPastDate = (date, history, userData) => {
    if (!history || history.length === 0) return { class: 'normal-day' };

    const sortedHistory = [...history].sort((a,b) => new Date(a.start_date) - new Date(b.start_date));
    let cycleStartDate, cycleLength, periodLength;

    const firstPeriodStart = moment(sortedHistory[0].start_date);

    if (date.isBefore(firstPeriodStart)) {
        // Estimate cycle length for the cycle before the very first recorded period
        const estimatedCycleLength = sortedHistory.length > 1
            ? moment(sortedHistory[1].start_date).diff(firstPeriodStart, 'days')
            : (userData.user.avg_cycle_length || userData.user.cycle_length);
        
        const estimatedCycleStart = firstPeriodStart.clone().subtract(estimatedCycleLength, 'days');

        if (date.isSameOrAfter(estimatedCycleStart)) {
            cycleStartDate = estimatedCycleStart;
            cycleLength = estimatedCycleLength;
            periodLength = 0; // Not in a recorded period
        }
    } else {
        // Original logic for dates after the first period started
        for (let i = 0; i < sortedHistory.length; i++) {
            const currentPeriodStart = moment(sortedHistory[i].start_date);
            const nextPeriodStart = i + 1 < sortedHistory.length ? moment(sortedHistory[i+1].start_date) : null;

            if (date.isSameOrAfter(currentPeriodStart) && (!nextPeriodStart || date.isBefore(nextPeriodStart))) {
                cycleStartDate = currentPeriodStart;
                periodLength = sortedHistory[i].duration;
                cycleLength = nextPeriodStart ? nextPeriodStart.diff(currentPeriodStart, 'days') : (userData.user.avg_cycle_length || userData.user.cycle_length);
                break;
            }
        }
    }

    if (!cycleStartDate) return { class: 'normal-day' };

    const dayOfCycle = date.diff(cycleStartDate, 'days') + 1;
    const periodEndDay = periodLength;
    const ovulationDay = Math.round(cycleLength - 14);
    const fertileStartDay = Math.max(1, ovulationDay - 5);
    const fertileEndDay = ovulationDay + 2;
    const pmsStartDay = Math.round(cycleLength - 4);
    
    if (periodLength > 0 && dayOfCycle >= 1 && dayOfCycle <= periodEndDay) return { class: 'period-day' };
    if (dayOfCycle >= fertileStartDay && dayOfCycle <= fertileEndDay) {
        if (dayOfCycle === ovulationDay) return { class: 'ovulation-day' };
        return { class: 'fertile-day' };
    }
    if (dayOfCycle >= pmsStartDay && dayOfCycle <= cycleLength) return { class: 'pms-day' };
    
    return { class: 'normal-day' };
};
// --- FIX END ---


// --- RENDER FUNCTIONS ---
const render = (html) => { 
    document.getElementById('app-content').innerHTML = html; 
};

/**
 * Renders the main dashboard view with corrected logic for period delay.
 * @param {object} userData - The complete user data object.
 */
// --- MODIFIED --- Added handling for the "no data" state
const renderDashboard = (userData) => {
    if (!userData || !userData.user) return;
    render(templates.home());

    const daysLeftEl = document.getElementById('days-left');
    const daysUnitEl = document.getElementById('days-unit');
    const pmsCountdownEl = document.getElementById('pms-countdown');
    const editPeriodBtn = document.getElementById('edit-period-btn');
    const nextPeriodContainer = document.getElementById('next-period-container');

    // --- NEW --- Handle state where there is no period history
    if (!userData.user.last_period_date) {
        daysLeftEl.textContent = '—';
        daysUnitEl.innerHTML = 'زمان پریودت رو ثبت کن';
        daysUnitEl.classList.add('!text-base');
        pmsCountdownEl.textContent = '';
        nextPeriodContainer.classList.add('hidden');
        editPeriodBtn.classList.add('animate-heartbeat');
        
        // Render an empty gray chart
        renderCycleChart(0, 0, 0, userData, 0, isFirstRender);
        isFirstRender = false;

        window.app.renderCalendar(moment());
        document.getElementById('settings-btn').classList.remove('hidden');
        document.getElementById('analysis-btn').classList.remove('hidden');
        document.getElementById('back-btn').classList.add('hidden');
        return;
    }

    // Existing logic for when data is present
    const today = moment().startOf('day');
    const cycleLength = userData.user.avg_cycle_length ? Math.round(userData.user.avg_cycle_length) : parseInt(userData.user.cycle_length);
    const periodLength = userData.user.avg_period_length ? Math.round(userData.user.avg_period_length) : parseInt(userData.user.period_length);
    const lastPeriodStart = moment(userData.user.last_period_date, 'YYYY-MM-DD');
    
    const expectedNextPeriodStart = lastPeriodStart.clone().add(cycleLength, 'days');

    let dayOfCycle;
    let daysDelayed = 0;

    if (today.isAfter(expectedNextPeriodStart, 'day')) {
        daysDelayed = today.diff(expectedNextPeriodStart, 'days');
        dayOfCycle = cycleLength + daysDelayed;
    } else {
        dayOfCycle = today.diff(lastPeriodStart, 'days') + 1;
    }
    
    let finalDayForChart = dayOfCycle;
    let delayForChart = daysDelayed;

    if (daysDelayed > 0) {
        daysLeftEl.textContent = toPersian(daysDelayed);
        daysUnitEl.textContent = 'روز تأخیر پریود';
        pmsCountdownEl.textContent = '';
        editPeriodBtn.classList.add('animate-heartbeat');
    } else if (dayOfCycle >= 1 && dayOfCycle <= periodLength) {
        const daysToEnd = periodLength - dayOfCycle + 1;
        daysLeftEl.textContent = toPersian(daysToEnd);
        daysUnitEl.textContent = 'روز تا پایان پریود';
        pmsCountdownEl.textContent = '';
        editPeriodBtn.classList.remove('animate-heartbeat');
    } else {
        const daysToPeriod = expectedNextPeriodStart.diff(today, 'days');
        daysLeftEl.textContent = toPersian(daysToPeriod);
        daysUnitEl.textContent = 'روز تا پریود بعدی';
        
        const pmsStartDay = cycleLength - 4;
        if (dayOfCycle > pmsStartDay) {
            pmsCountdownEl.textContent = '';
        } else {
            const daysToPms = pmsStartDay - dayOfCycle;
            pmsCountdownEl.textContent = `${toPersian(daysToPms)} روز تا PMS`;
        }
        editPeriodBtn.classList.remove('animate-heartbeat');
    }
    
    document.getElementById('next-period-date').textContent = toPersian(expectedNextPeriodStart.format('dddd، jD jMMMM'));

    renderCycleChart(finalDayForChart, cycleLength, periodLength, userData, delayForChart, isFirstRender);
    isFirstRender = false;

    window.app.renderCalendar(moment());
    
    document.getElementById('settings-btn').classList.remove('hidden');
    document.getElementById('analysis-btn').classList.remove('hidden');
    document.getElementById('back-btn').classList.add('hidden');
};

/**
 * Renders the circular cycle chart with new logic for delay arc.
 * @param {number} dayOfCycle - The current day of the user's cycle (can be > cycleLength if delayed).
 * @param {number} cycleLength - The user's average cycle length.
 * @param {number} periodLength - The user's average period length.
 * @param {object} userData - The complete user data object.
 * @param {number} daysDelayed - The number of days the period is late.
 * @param {boolean} isInitialAnimation - Flag to trigger the drawing animation.
 */
// --- MODIFIED --- Added handling for empty/no-data state
const renderCycleChart = (dayOfCycle, cycleLength, periodLength, userData, daysDelayed = 0, isInitialAnimation = false) => {
    const svg = document.getElementById('cycle-chart');
    if (!svg) return;
    svg.innerHTML = ''; 

    const center = 100, radius = 75;

    // Draw background circle first
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', center); bgCircle.setAttribute('cy', center); bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('class', 'cycle-chart-path cycle-chart-bg');
    svg.appendChild(bgCircle);

    // --- NEW --- If there's no cycle length, it's the "no data" state. Just show the gray circle and stop.
    if (!cycleLength || cycleLength <= 0) {
        return;
    }

    const chartTotalDays = cycleLength + daysDelayed;
    const degreesPerDay = 360 / chartTotalDays;

    const ovulationDay = cycleLength - 14;
    const phases = {
        period: { start: 1, end: periodLength, class: 'cycle-chart-period', label: 'پریود', labelClass: 'label-period' },
        fertile: { start: Math.max(1, ovulationDay - 5), end: ovulationDay + 2, class: 'cycle-chart-fertile', label: 'باروری', labelClass: 'label-fertile' },
        pms: { start: cycleLength - 4, end: cycleLength, class: 'cycle-chart-pms', label: 'PMS', labelClass: 'label-pms' }
    };
    
    const polarToCartesian = (centerX, centerY, r, angleInDegrees) => {
        const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
        return { x: centerX + (r * Math.cos(angleInRadians)), y: centerY + (r * Math.sin(angleInRadians)) };
    };
    const describeArc = (x, y, r, startAngle, endAngle) => {
        if (endAngle - startAngle >= 360) endAngle = startAngle + 359.99;
        const start = polarToCartesian(x, y, r, endAngle);
        const end = polarToCartesian(x, y, r, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
    };

    svg.innerHTML = `<defs><filter id="shadow"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.2"/></filter></defs>`;
    svg.appendChild(bgCircle); // Re-append after clearing innerHTML

    // --- NEW: Helper function to apply animation ---
    const applyAnimation = (element) => {
        if (isInitialAnimation) {
            const length = element.getTotalLength();
            element.style.strokeDasharray = length;
            element.style.strokeDashoffset = length;
            element.classList.add('animate-draw');
        }
    };

    Object.values(phases).forEach(phase => {
        const startAngle = (phase.start - 1) * degreesPerDay;
        const endAngle = phase.end * degreesPerDay;
        const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arcPath.setAttribute('d', describeArc(center, center, radius, startAngle, endAngle));
        arcPath.setAttribute('class', `cycle-chart-path ${phase.class}`);
        svg.appendChild(arcPath);
        
        applyAnimation(arcPath);

        const textRadius = radius + 16;
        const midAngle = startAngle + (endAngle - startAngle) / 2;
        const pos = polarToCartesian(center, center, textRadius, midAngle);
        let rotation = midAngle;
        if (midAngle > 90 && midAngle < 270) rotation += 180;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pos.x); text.setAttribute('y', pos.y);
        text.setAttribute('transform', `rotate(${rotation}, ${pos.x}, ${pos.y})`);
        text.setAttribute('class', `cycle-chart-label ${phase.labelClass}`);
        text.textContent = phase.label;
        svg.appendChild(text);
    });

    if (daysDelayed > 0) {
        const startAngle = cycleLength * degreesPerDay;
        const endAngle = chartTotalDays * degreesPerDay;
        const delayArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        delayArc.setAttribute('d', describeArc(center, center, radius, startAngle, endAngle));
        delayArc.setAttribute('class', 'cycle-chart-path cycle-chart-delay');
        svg.appendChild(delayArc);
        
        applyAnimation(delayArc);

        const textRadius = radius + 16;
        const midAngle = startAngle + (endAngle - startAngle) / 2;
        const adjustedMidAngle = midAngle >= 359 ? 359 : midAngle;
        const pos = polarToCartesian(center, center, textRadius, adjustedMidAngle);
        let rotation = adjustedMidAngle;
        if (adjustedMidAngle > 90 && adjustedMidAngle < 270) rotation += 180;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', pos.y);
        text.setAttribute('transform', `rotate(${rotation}, ${pos.x}, ${pos.y})`);
        text.setAttribute('class', 'cycle-chart-label label-delay');
        text.textContent = 'تأخیر';
        svg.appendChild(text);
    }

    for (let i = 1; i <= chartTotalDays; i++) {
        const angle = (i - 0.5) * degreesPerDay;
        const pos = polarToCartesian(center, center, radius, angle);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', pos.x);
        dot.setAttribute('cy', pos.y);
        dot.setAttribute('r', 1.2);
        dot.setAttribute('fill', 'white');
        svg.appendChild(dot);
    }

    const todayAngle = (dayOfCycle - 0.5) * degreesPerDay;
    const indicatorPos = polarToCartesian(center, center, radius, todayAngle);
    const indicatorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    indicatorGroup.setAttribute('filter', 'url(#shadow)');
    
    const indicatorCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    indicatorCircle.setAttribute('cx', indicatorPos.x); indicatorCircle.setAttribute('cy', indicatorPos.y);
    indicatorCircle.setAttribute('r', 12); indicatorCircle.setAttribute('class', 'today-indicator-circle');
    
    const todayPhaseInfo = getPhaseInfoForDate(moment(), userData.user);
    const phaseColorMap = { 'period-day': '#f87171', 'fertile-day': '#4ade80', 'ovulation-day': '#4ade80', 'pms-day': '#facc15', 'normal-day': '#e5e7eb' };
    
    indicatorCircle.style.stroke = daysDelayed > 0 ? '#4b5563' : phaseColorMap[todayPhaseInfo.class];
    
    const indicatorText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    indicatorText.setAttribute('x', indicatorPos.x); indicatorText.setAttribute('y', indicatorPos.y);
    indicatorText.setAttribute('class', 'today-indicator-text');
    indicatorText.innerHTML = `<tspan x="${indicatorPos.x}" dy="-0.4em" style="font-size: 7px;">روز</tspan><tspan x="${indicatorPos.x}" dy="1.1em" style="font-size: 9px; font-weight: bold;">${toPersian(dayOfCycle)}</tspan>`;
    
    indicatorGroup.appendChild(indicatorCircle);
    indicatorGroup.appendChild(indicatorText);
    svg.appendChild(indicatorGroup);
};

const renderCalendar = (calendarDate, userData) => {
    if (!userData.user) return;
    document.getElementById('calendar-month-year').textContent = toPersian(calendarDate.format('jMMMM jYYYY'));
    const calendarGrid = document.getElementById('calendar-grid');
    calendarGrid.innerHTML = '';
    const monthStart = calendarDate.clone().startOf('jMonth');
    const monthEnd = calendarDate.clone().endOf('jMonth');
    
    const recordedPeriodDays = new Set();
    if (userData.period_history) {
        userData.period_history.forEach(record => {
            const start = moment(record.start_date, 'YYYY-MM-DD');
            for (let i = 0; i < record.duration; i++) {
                recordedPeriodDays.add(start.clone().add(i, 'days').format('YYYY-MM-DD'));
            }
        });
    }

    const isPastMonth = monthEnd.isBefore(moment(), 'startOf', 'month');
    const hasRecordInMonth = userData.period_history && userData.period_history.some(record => {
        const recordStart = moment(record.start_date, 'YYYY-MM-DD');
        const recordEnd = recordStart.clone().add(record.duration - 1, 'days');
        return recordStart.isSameOrBefore(monthEnd) && recordEnd.isSameOrAfter(monthStart);
    });
    
    for (let i = 0; i < monthStart.jDay(); i++) { calendarGrid.innerHTML += '<div></div>'; }
    
    for (let day = monthStart.clone(); day.isSameOrBefore(monthEnd); day.add(1, 'days')) {
        const dayKey = day.format('YYYY-MM-DD');
        const canLog = day.isSameOrBefore(moment(), 'day');
        
        let phaseInfo = { class: 'normal-day' };
        
        if (recordedPeriodDays.has(dayKey)) {
            phaseInfo = { class: 'period-day' };
        } else if (isPastMonth && hasRecordInMonth) {
            phaseInfo = getPhaseInfoForPastDate(day, userData.period_history, userData);
        } else if (!isPastMonth) {
            phaseInfo = getPhaseInfoForDate(day, userData.user);
        }

        let classes = `calendar-day ${phaseInfo.class} `;
        
        if (day.isSame(moment(), 'day')) classes += ' today';
        if (!canLog) classes += ' disabled';
        
        const logData = userData.logs?.[dayKey];
        const hasLog = logData && Object.values(logData).some(v => (Array.isArray(v) && v.length > 0) || (typeof v === 'string' && v) || (typeof v === 'number' && v !== ''));
        const logIndicator = hasLog ? '<div class="log-indicator"></div>' : '';
        const clickHandler = canLog ? `onclick="window.app.openLogModal('${dayKey}')"` : '';
        calendarGrid.innerHTML += `<div class="${classes}" ${clickHandler}><span>${toPersian(day.jDate())}</span>${logIndicator}</div>`;
    }
};

const renderSettings = (userData) => {
    render(templates.settings());
    const populateSelect=(id,s,e,u='')=>{const el=document.getElementById(id);el.innerHTML='';for(let i=s;i>=e;i--)el.innerHTML+=`<option value="${i}">${toPersian(i)}${u}</option>`;};
    populateSelect('settings-cycle-length',60,21,' روز');
    populateSelect('settings-period-length',12,3,' روز');
    populateSelect('settings-birth-year',1396,1350);
    const s=id=>document.getElementById('settings-'+id);
    s('cycle-length').value=userData.user.cycle_length;
    s('period-length').value=userData.user.period_length;
    s('birth-year').value=userData.user.birth_year;
    document.getElementById('settings-btn').classList.add('hidden');
    document.getElementById('analysis-btn').classList.add('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
};

const renderAnalysis = (userData, charts) => {
    render(templates.analysis());
    let currentFilter = { months: 1, phase: 'all' };
    
    const createBarChart = (canvasId, data, label) => {
        const container = document.getElementById(canvasId)?.parentElement;
        if (!container) return;
        if (charts[canvasId]) charts[canvasId].destroy();
        container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
        const ctx = document.getElementById(canvasId);
        if (!ctx || data.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-500 p-4">داده‌ای برای نمایش در این بازه زمانی وجود ندارد.</p>`;
            return;
        }
        charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels: data.map(item => item[0]), datasets: [{ label, data: data.map(item => item[1]), backgroundColor: 'rgba(236, 72, 153, 0.6)', borderColor: 'rgba(236, 72, 153, 1)', borderWidth: 1 }] }, options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1, callback: (v) => toPersian(v) } } } } });
    };

    const createLineChart = (canvasId, data, label, unit) => {
        const container = document.getElementById(canvasId)?.parentElement;
        if (!container) return;
        if (charts[canvasId]) charts[canvasId].destroy();
        container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
        const ctx = document.getElementById(canvasId);
        if (!ctx || data.labels.length < 2) {
            container.innerHTML = `<p class="text-center text-gray-500 p-4">داده کافی برای رسم نمودار خطی وجود ندارد.</p>`;
            return;
        }
        charts[canvasId] = new Chart(ctx, { type: 'line', data: { labels: data.labels.map(l => toPersian(moment(l, 'YYYY-MM-DD').format('jM/jD'))), datasets: [{ label, data: data.data, fill: false, borderColor: 'rgba(236, 72, 153, 1)', backgroundColor: 'rgba(236, 72, 153, 0.6)', tension: 0.1 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false, ticks: { callback: (value) => toPersian(value) + ` ${unit}` } }, x: { ticks: { callback: function(val, index) { return index % Math.ceil(data.labels.length / 7) === 0 ? this.getLabelForValue(val) : ''; } } } } } });
    };

    const updateAnalysisCharts = (months, phase) => {
        const startDate = moment().subtract(months, 'months');
        
        const recordedPeriodDays = new Set();
        const periodHistorySorted = [...(userData.period_history || [])].sort((a,b) => new Date(a.start_date) - new Date(b.start_date));
        
        periodHistorySorted.forEach(record => {
            const start = moment(record.start_date, 'YYYY-MM-DD');
            for (let i = 0; i < record.duration; i++) {
                recordedPeriodDays.add(start.clone().add(i, 'days').format('YYYY-MM-DD'));
            }
        });

        const getLogPhase = (logDate) => {
            const dateStr = logDate.format('YYYY-MM-DD');
            if (recordedPeriodDays.has(dateStr)) return 'period';
            
            let relevantCycleStart, cycleLength;
            for (let i = 0; i < periodHistorySorted.length; i++) {
                const currentPeriodStart = moment(periodHistorySorted[i].start_date);
                const nextPeriodStart = i + 1 < periodHistorySorted.length ? moment(periodHistorySorted[i+1].start_date) : null;
                
                if (logDate.isSameOrAfter(currentPeriodStart) && (!nextPeriodStart || logDate.isBefore(nextPeriodStart))) {
                    relevantCycleStart = currentPeriodStart;
                    cycleLength = nextPeriodStart ? nextPeriodStart.diff(currentPeriodStart, 'days') : (userData.user.avg_cycle_length || userData.user.cycle_length);
                    break;
                }
            }
            
            if (relevantCycleStart) {
                const pmsStartDay = cycleLength - 4;
                const dayOfCycle = logDate.diff(relevantCycleStart, 'days') + 1;
                if (dayOfCycle >= pmsStartDay && dayOfCycle <= cycleLength) return 'pms';
            }
            return 'other';
        };

        const processLogs = (categories) => {
            const counts = {};
            Object.entries(userData.logs || {}).forEach(([dateKey, log]) => {
                const logDate = moment(dateKey, 'YYYY-MM-DD');
                if (!logDate.isSameOrAfter(startDate)) return;
                const currentPhase = getLogPhase(logDate);
                if (phase === 'all' || currentPhase === phase) {
                    categories.forEach(categoryKey => {
                        if (log[categoryKey]) {
                            const items = Array.isArray(log[categoryKey]) ? log[categoryKey] : [log[categoryKey]];
                            items.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
                        }
                    });
                }
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        };

        const processMetricLogs = (metricKey) => {
            const metricData = [];
            Object.entries(userData.logs || {}).forEach(([dateKey, log]) => {
                const logDate = moment(dateKey, 'YYYY-MM-DD');
                if (!logDate.isSameOrAfter(startDate)) return;
                const currentPhase = getLogPhase(logDate);
                if ((phase === 'all' || currentPhase === phase) && log[metricKey] !== undefined && log[metricKey] !== '') {
                    metricData.push({ date: logDate, value: parseFloat(log[metricKey]) });
                }
            });
            metricData.sort((a, b) => a.date - b.date);
            return { labels: metricData.map(d => d.date.format('YYYY-MM-DD')), data: metricData.map(d => d.value) };
        };
        
        const chartContainer = document.getElementById('analysis-charts');
        chartContainer.innerHTML = `
            <div><h3 class="text-xl font-bold text-gray-800 mb-2">علائم پرتکرار</h3><div class="bg-gray-100 p-4 rounded-lg"><canvas id="symptoms-chart"></canvas></div></div>
            <div><h3 class="text-xl font-bold text-gray-800 mb-2">حالات روحی پرتکرار</h3><div class="bg-gray-100 p-4 rounded-lg"><canvas id="moods-chart"></canvas></div></div>
            <div><h3 class="text-xl font-bold text-gray-800 mb-2">روند تغییرات وزن</h3><div class="bg-gray-100 p-4 rounded-lg"><canvas id="weight-chart"></canvas></div></div>
            <div><h3 class="text-xl font-bold text-gray-800 mb-2">روند نوشیدن آب</h3><div class="bg-gray-100 p-4 rounded-lg"><canvas id="water-chart"></canvas></div></div>
            <div><h3 class="text-xl font-bold text-gray-800 mb-2">روند وضعیت خواب</h3><div class="bg-gray-100 p-4 rounded-lg"><canvas id="sleep-chart"></canvas></div></div>
        `;
        
        createBarChart('symptoms-chart', processLogs(ALL_SYMPTOM_CATEGORIES), 'تعداد روزها');
        createBarChart('moods-chart', processLogs(['moods']), 'تعداد روزها');
        createLineChart('weight-chart', processMetricLogs('weight'), 'وزن', 'kg');
        createLineChart('water-chart', processMetricLogs('water'), 'آب', 'لیوان');
        createLineChart('sleep-chart', processMetricLogs('sleep'), 'خواب', 'ساعت');
    };

    const tabs = document.querySelectorAll('.analysis-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.classList.contains('time-tab')) {
                document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active-tab'));
                currentFilter.months = parseInt(tab.dataset.months);
            }
            if (tab.classList.contains('phase-tab')) {
                document.querySelectorAll('.phase-tab').forEach(t => t.classList.remove('active-tab'));
                currentFilter.phase = tab.dataset.phase;
            }
            tab.classList.add('active-tab');
            updateAnalysisCharts(currentFilter.months, currentFilter.phase);
        });
    });

    updateAnalysisCharts(currentFilter.months, currentFilter.phase);
    document.getElementById('settings-btn').classList.add('hidden');
    document.getElementById('analysis-btn').classList.add('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
};