// app.js

document.addEventListener('DOMContentLoaded', function() {
    try {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        const TELEGRAM_ID = tg.initDataUnsafe?.user?.id || '123456789';
        const TELEGRAM_USERNAME = tg.initDataUnsafe?.user?.username || null;
        const TELEGRAM_FIRSTNAME = tg.initDataUnsafe?.user?.first_name || 'کاربر';


        // --- STATE & DOM ELEMENTS ---
        let userData = { user: null, logs: {}, period_history: [], companions: [] };
        let calendarDate = moment();
        let selectedLogDate = null;
        // *** MODIFICATION: Add periodHistory to datepicker state ***
        let datepickerState = { visible: false, targetInputId: null, currentDate: moment().locale('fa'), periodHistory: [] };
        let charts = {};

        // --- DOM Element References ---
        const appContent = document.getElementById('app-content');
        const settingsBtn = document.getElementById('settings-btn');
        const analysisBtn = document.getElementById('analysis-btn');
        const backBtn = document.getElementById('back-btn');
        const logModal = document.getElementById('log-modal');
        const logModalContent = document.getElementById('log-modal-content');
        const datepickerModal = document.getElementById('datepicker-modal');
        const datepickerModalContent = document.getElementById('datepicker-modal-content');
        const editPeriodModal = document.getElementById('edit-period-modal');
        const editPeriodModalContent = document.getElementById('edit-period-modal-content');
        const confirmationModal = document.getElementById('confirmation-modal');
        const deleteChoiceModal = document.getElementById('delete-period-choice-modal');

        // --- TOAST NOTIFICATION ---
        const toast = document.createElement('div');
        toast.style.cssText = 'position: fixed; bottom: -100px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: white; font-weight: 500; transition: bottom 0.5s ease-in-out; z-index: 100; text-align: center; font-size: 14px;';
        document.body.appendChild(toast);
        let toastTimeout;

        const showToast = (message, isError = false) => {
            toast.textContent = message;
            toast.style.backgroundColor = isError ? '#be123c' : '#16a34a';
            toast.style.bottom = '20px';
            clearTimeout(toastTimeout);
            toastTimeout = setTimeout(() => {
                toast.style.bottom = '-100px';
            }, 3000);
        };

        const showConfirmationModal = (title, message, onConfirm) => {
            document.getElementById('confirmation-title').textContent = title;
            document.getElementById('confirmation-message').textContent = message;
            let currentConfirmBtn = document.getElementById('confirm-action-btn');
            const newConfirmBtn = currentConfirmBtn.cloneNode(true);
            currentConfirmBtn.parentNode.replaceChild(newConfirmBtn, currentConfirmBtn);
            newConfirmBtn.onclick = () => {
                onConfirm();
                confirmationModal.classList.remove('visible');
            };
            confirmationModal.classList.add('visible');
        };

        // --- MAIN APP LOGIC OBJECT ---
        window.app = {
            onboardingData: {},
            async init(refreshOnly = false) {
                // moment.locale('fa');
                try {
                    // Update user info silently in the background
                    fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}/update-info`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            telegram_username: TELEGRAM_USERNAME,
                            telegram_firstname: TELEGRAM_FIRSTNAME,
                        }),
                    });

                    const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}`);
                    if (response.status === 404) {
                        if (!refreshOnly) this.nextStep(1);
                    } else if (response.ok) {
                        const data = await response.json();
                        userData = data;
                        if (!refreshOnly) renderDashboard(userData);
                    } else {
                        const err = await response.json();
                        throw new Error(err.error || 'خطا در دریافت اطلاعات کاربر');
                    }
                } catch (error) {
                    console.error('Initialization failed:', error);
                    if (!refreshOnly) {
                        appContent.innerHTML = `<div class="text-center text-red-500 p-8">ارتباط با سرور برقرار نشد.</div>`;
                    }
                    showToast(error.message, true);
                }
            },
            async nextStep(step) {
                if (step === 2) this.onboardingData.cycle_length = document.getElementById('cycle-length').value;
                if (step === 3) this.onboardingData.period_length = document.getElementById('period-length').value;
                if (step === 4) {
                    const dateInput = document.getElementById('onboarding-date-input');
                    if (!dateInput.dataset.value) {
                        showToast('لطفاً تاریخ آخرین پریود را انتخاب کنید.', true);
                        return;
                    }
                    this.onboardingData.last_period_date = dateInput.dataset.value;
                }

                if (step > 4) {
                    this.onboardingData.birth_year = document.getElementById('birth-year').value;
                    this.onboardingData.telegram_id = TELEGRAM_ID;
                    this.onboardingData.telegram_username = TELEGRAM_USERNAME;
                    this.onboardingData.telegram_firstname = TELEGRAM_FIRSTNAME; // Add firstname
                    try {
                        const response = await fetch(`${API_BASE_URL}/onboarding`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(this.onboardingData)
                        });
                        const data = await response.json();
                        if (response.status !== 201) {
                            throw new Error(data.error || 'خطا در ثبت‌نام');
                        }
                        showToast(data.message);
                        await this.init();
                    } catch (error) {
                        console.error('Onboarding failed:', error);
                        showToast(error.message, true);
                    }
                } else {
                    render(templates.onboardingStep(step));
                    if (step === 1 || step === 2 || step === 4) {
                        const populateSelectsForStep = (elId, start, end, unit = '') => { const el = document.getElementById(elId); el.innerHTML = ''; for (let i = start; i >= end; i--) el.innerHTML += `<option value="${i}">${toPersian(i)}${unit}</option>`; };
                        const config = { 1: ['cycle-length', 60, 21, ' روز'], 2: ['period-length', 12, 3, ' روز'], 4: ['birth-year', 1396, 1350] };
                        if (config[step]) {
                            populateSelectsForStep(...config[step]);
                            if(step === 1) document.getElementById('cycle-length').value = 28;
                            if(step === 2) document.getElementById('period-length').value = 7;
                            if(step === 4) document.getElementById('birth-year').value = 1375;
                        }
                    }
                }
            },
            async saveSettings() {
                const settingsData = {
                    cycle_length: document.getElementById('settings-cycle-length').value,
                    period_length: document.getElementById('settings-period-length').value,
                    birth_year: document.getElementById('settings-birth-year').value,
                    reminder_logs: document.getElementById('settings-reminder-logs').checked,
                    reminder_cycle: document.getElementById('settings-reminder-cycle').checked,
                };
                try {
                    const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(settingsData)
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'خطا در ذخیره تنظیمات');

                    userData.user = data.user;
                    showToast(data.message);
                    renderDashboard(userData);
                } catch (error) {
                    console.error('Failed to save settings:', error);
                    showToast(error.message, true);
                }
            },
            async saveLog() {
                const newLog = {};
                for (const itemKey in LOG_CONFIG.metrics.items) {
                    const input = document.getElementById(`log-${itemKey}`);
                    if (!input) continue;
                    if (LOG_CONFIG.metrics.items[itemKey].type === 'slider') {
                        if (input.dataset.interacted === 'true') newLog[itemKey] = input.value;
                    } else {
                       if (input.value !== '') newLog[itemKey] = input.value;
                    }
                }
                document.querySelectorAll('#log-modal .symptom-chip.selected').forEach(el => {
                    const { category, value } = el.dataset;
                    if (LOG_CONFIG[category].single) {
                        newLog[category] = value;
                    } else {
                        if (!newLog[category]) newLog[category] = [];
                        newLog[category].push(value);
                    }
                });
                const notes = document.getElementById('log-notes').value;
                if (notes) newLog.notes = notes;

                const payload = { user_id: userData.user.id, log_date: selectedLogDate, ...newLog };
                try {
                    const response = await fetch(`${API_BASE_URL}/logs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'خطا در ذخیره گزارش');

                    if (data.log) userData.logs[selectedLogDate] = data.log;
                    else delete userData.logs[selectedLogDate];

                    showToast(data.message);
                } catch (error) {
                     console.error('Failed to save log:', error);
                     showToast(error.message, true);
                }
                logModal.classList.remove('visible');
                this.renderCalendar(calendarDate);
            },
            async deleteLog() {
                if (!userData.logs[selectedLogDate]) {
                    logModal.classList.remove('visible');
                    this.renderCalendar(calendarDate);
                    return;
                };
                try {
                    const response = await fetch(`${API_BASE_URL}/logs`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userData.user.id, log_date: selectedLogDate })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'خطا در حذف گزارش');

                    delete userData.logs[selectedLogDate];
                    showToast(data.message);
                } catch (error) {
                    console.error('Failed to delete log:', error);
                    showToast(error.message, true);
                }
                logModal.classList.remove('visible');
                this.renderCalendar(calendarDate);
            },
            async savePeriodUpdate() {
                const dateInput = document.getElementById('edit-period-date-input');
                const periodUpdateData = {
                    start_date: dateInput.dataset.value,
                    duration: document.getElementById('edit-period-length').value,
                };
                try {
                    const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}/period`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(periodUpdateData)
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'خطا در ثبت اطلاعات');

                    await this.init(true);
                    showToast(data.message);
                    editPeriodModal.classList.remove('visible');
                    renderDashboard(userData);
                } catch (error) {
                    console.error('Failed to update period data:', error);
                    showToast(error.message, true);
                }
            },
            openDeletePeriodChoiceModal() {
                editPeriodModal.classList.remove('visible');
                deleteChoiceModal.classList.add('visible');
            },
            handleDeletePeriod(scope) {
                deleteChoiceModal.classList.remove('visible');
                const title = (scope === 'last') ? 'حذف آخرین سابقه' : 'حذف تمام سوابق';
                const message = (scope === 'last')
                    ? 'آیا از حذف آخرین سابقه پریود خود مطمئن هستید؟ این عمل غیرقابل بازگشت است.'
                    : 'آیا مطمئن هستید؟ تمام تاریخچه پریود شما حذف خواهد شد. این عمل غیرقابل بازگشت است.';

                showConfirmationModal(title, message, async () => {
                    try {
                        const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}/period`, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ scope: scope })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'خطا در حذف سوابق');

                        await this.init(true);
                        showToast(data.message);
                        renderDashboard(userData);
                    } catch (error) {
                        console.error('Failed to delete period history:', error);
                        showToast(error.message, true);
                    }
                });
            },
            deleteAccount() {
                showConfirmationModal(
                    'حذف حساب کاربری',
                    'آیا مطمئن هستید؟ تمام اطلاعات شما، شامل سوابق پریود و علائم، برای همیشه پاک خواهد شد. این عمل غیرقابل بازگشت است.',
                    async () => {
                        try {
                            const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}`, {
                                method: 'DELETE'
                            });
                            const data = await response.json();
                            if (!response.ok) {
                                throw new Error(data.error || 'خطا در حذف حساب');
                            }
                            showToast(data.message);
                            setTimeout(() => {
                                window.location.reload();
                            }, 1500);
                        } catch (error) {
                            console.error('Failed to delete account:', error);
                            showToast(error.message, true);
                        }
                    }
                );
            },
            async generateInviteLink() {
                showToast('در حال ایجاد لینک دعوت...');
                try {
                    const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}/generate-invite`, {
                        method: 'POST'
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error);
                    showToast(data.message);
                } catch (error) {
                    showToast(error.message, true);
                }
            },
            deleteCompanion(companionId, companionName) {
                showConfirmationModal(
                    `حذف ${companionName}`,
                    `آیا از حذف این همراه مطمئن هستید؟`,
                    async () => {
                        try {
                            const response = await fetch(`${API_BASE_URL}/companion/${companionId}`, {
                                method: 'DELETE'
                            });
                            const data = await response.json();
                            if (!response.ok) throw new Error(data.error);
                            showToast(data.message);
                            await this.init(true); // Refresh data
                            this.goToSettings(); // Re-render settings page
                        } catch (error) {
                            showToast(error.message, true);
                        }
                    }
                );
            },
            async updateCompanionNotification(companionId, isChecked) {
                 try {
                    const response = await fetch(`${API_BASE_URL}/companion/${companionId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ notify_daily_symptoms: isChecked })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error);
                    showToast("تنظیمات اعلان همراه به‌روزرسانی شد.");
                    // Update local state to avoid full reload
                    const companion = userData.companions.find(c => c.id === companionId);
                    if (companion) {
                        companion.notify_daily_symptoms = isChecked;
                    }
                 } catch (error) {
                    showToast(error.message, true);
                 }
            },
            toggleCompanionInfo(event) {
                event.stopPropagation();
                const popover = document.getElementById('companion-info-popover');
                this._togglePopover(event, popover);
            },
            toggleSymptomsInfo(event) {
                event.stopPropagation();
                const popover = document.getElementById('symptoms-info-popover');
                this._togglePopover(event, popover);
            },
            _togglePopover(event, popover) {
                 const icon = event.currentTarget;
                const closePopover = () => {
                    popover.classList.remove('visible');
                    document.body.removeEventListener('click', closePopover);
                };
                if (popover.classList.contains('visible')) {
                    closePopover();
                } else {
                    popover.style.top = `${icon.offsetTop + icon.offsetHeight + 8}px`;
                    popover.style.left = `${icon.offsetLeft + (icon.offsetWidth / 2) - (popover.offsetWidth / 2)}px`;
                    popover.classList.add('visible');
                    setTimeout(() => {
                        document.body.addEventListener('click', closePopover, { once: true });
                    }, 0);
                }
            },

            async exportToXLSX(months) {
                const spinner = document.getElementById('spinner-overlay');
                spinner.classList.add('visible');
                try {
                    const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}/report`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ months: months })
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.error || 'خطا در درخواست گزارش از سرور.');
                    }

                    showToast(data.message);

                } catch (error) {
                    console.error("Failed to request XLSX report:", error);
                    tg.showAlert(error.message);
                    showToast(error.message, true);
                } finally {
                    spinner.classList.remove('visible');
                }
            },

            goToSettings() { renderSettings(userData); },
            goToAnalysis() { renderAnalysis(userData, charts); },
            goToDashboard() { renderDashboard(userData); },
            changeMonth(direction) { calendarDate.add(direction, 'jMonth'); this.renderCalendar(calendarDate); },
            renderCalendar(date) { calendarDate = date; renderCalendar(calendarDate, userData); },
            logToday() { const todayStr = moment().format('YYYY-MM-DD'); this.openLogModal(todayStr); },
            goToToday() {
                calendarDate = moment();
                this.renderCalendar(calendarDate);
                setTimeout(() => {
                    const todayEl = document.querySelector('#calendar-grid .today');
                    if (todayEl) {
                        todayEl.classList.add('animate-heartbeat');
                        setTimeout(() => {
                            todayEl.classList.remove('animate-heartbeat');
                        }, 2000);
                    }
                }, 50);
            },
            openLogModal(dateKey) {
                selectedLogDate = dateKey;
                const currentLog = userData.logs[selectedLogDate] || {};
                const shouldNotifyCompanion = userData.companions && userData.companions.some(c => c.notify_daily_symptoms);
                let modalBodyHTML = `<div class="flex justify-between items-center mb-4"><button id="delete-log-btn" class="text-red-500 hover:text-red-700 text-sm font-semibold ${Object.keys(currentLog).length > 0 ? '' : 'invisible'}">حذف علائم</button><h3 class="text-xl font-bold text-center">ثبت علائم</h3><div class="w-16"></div></div><p class="text-center text-gray-500 mb-4 -mt-4">${toPersian(moment(dateKey, 'YYYY-MM-DD').locale('fa').format('dddd jD jMMMM'))}</p><div class="space-y-4">`;
                for (const categoryKey in LOG_CONFIG) {
                    if (categoryKey === 'moods' && shouldNotifyCompanion) {
                        modalBodyHTML += `<div class="p-3 pt-4 bg-pink-50 rounded-lg border border-pink-200 space-y-4 relative"><span class="absolute top-2 left-3 text-xs text-pink-600 font-semibold">اطلاع‌رسانی به همراه</span>`;
                    }
                    const category = LOG_CONFIG[categoryKey];
                    modalBodyHTML += `<div><h4 class="font-semibold mb-2 text-gray-600">${category.title}</h4>`;
                    if (categoryKey === 'metrics') {
                        modalBodyHTML += '<div class="space-y-3">';
                        for(const itemKey in category.items) {
                            const item = category.items[itemKey];
                            let value = currentLog[itemKey];
                            if(item.type === 'number') {
                                modalBodyHTML += `<div><label class="block text-sm text-gray-500">${item.title}</label><input type="number" id="log-${itemKey}" min="${item.min}" max="${item.max}" step="${item.step}" value="${value || ''}" placeholder="--" class="w-full p-2 border rounded-lg bg-gray-50 text-center"></div>`;
                            } else if (item.type === 'slider') {
                                const hasValue = value !== undefined && value !== null && value !== '';
                                let displayValue = hasValue ? `${toPersian(value)} ${item.unit}` : '--';
                                let sliderValueAttr = hasValue ? `value="${value}"` : `value="${item.min}"`;
                                let interacted = hasValue ? 'true' : 'false';
                                modalBodyHTML += `<div><div class="flex justify-between text-sm text-gray-500"><span>${item.title}</span><span id="log-${itemKey}-value">${displayValue}</span></div><input type="range" id="log-${itemKey}" min="${item.min}" max="${item.max}" step="${item.step}" ${sliderValueAttr} data-interacted="${interacted}" class="w-full" oninput="this.dataset.interacted = 'true'; document.getElementById('log-${itemKey}-value').textContent = window.toPersian(this.value) + ' ${item.unit}'"></div>`;
                            }
                        }
                        modalBodyHTML += '</div>';
                    } else {
                        modalBodyHTML += '<div class="flex flex-wrap justify-center gap-2 text-sm">';
                        const currentItems = currentLog[categoryKey] || (category.single ? null : []);
                        for (const item in category.items) {
                            const isSelected = category.single ? currentItems === item : (Array.isArray(currentItems) && currentItems.includes(item));
                            modalBodyHTML += `<div class="symptom-chip ${isSelected ? 'selected' : ''}" data-category="${categoryKey}" data-value="${item}">${category.items[item]} ${item}</div>`;
                        }
                        modalBodyHTML += `</div>`;
                    }
                    modalBodyHTML += `</div>`;
                    if (categoryKey === 'symptoms' && shouldNotifyCompanion) {
                        modalBodyHTML += `</div>`;
                    }
                }
                modalBodyHTML += `<div><div class="flex justify-between items-center mb-2"><h4 class="font-semibold text-gray-600">توضیحات دیگر</h4><span id="notes-char-count" class="text-xs text-gray-400"></span></div><textarea id="log-notes" class="w-full p-2 border rounded-lg bg-gray-50" rows="3" maxlength="500" oninput="document.getElementById('notes-char-count').textContent = toPersian(this.value.length) + ' / ' + toPersian(500)">${currentLog.notes || ''}</textarea></div></div>`;
                const modalFooterHTML = `<div class="flex gap-4"><button id="save-log-btn" class="w-full bg-pink-500 text-white font-bold py-3 rounded-lg">ذخیره</button><button id="close-log-btn" class="w-full bg-gray-200 text-gray-700 font-bold py-3 rounded-lg">انصراف</button></div>`;
                logModalContent.innerHTML = `<div class="modal-body">${modalBodyHTML}</div><div class="modal-footer">${modalFooterHTML}</div>`;
                logModal.classList.add('visible');
                document.getElementById('log-notes').dispatchEvent(new Event('input'));
            },
            // *** START: MODIFICATION to accept period history ***
            openDatePicker(targetInputId, periodHistory = []) {
                const targetInput = document.getElementById(targetInputId);
                const initialDate = targetInput.dataset.value ? moment(targetInput.dataset.value, 'YYYY-MM-DD') : moment();
                datepickerState.targetInputId = targetInputId;
                datepickerState.currentDate = initialDate.clone();
                datepickerState.periodHistory = periodHistory; // Store history
                this.renderDatePicker();
                datepickerModal.classList.add('visible');
            },
            renderDatePicker() {
                const { currentDate, targetInputId, periodHistory } = datepickerState;
                const targetInput = document.getElementById(targetInputId);
                const selectedDate = targetInput.dataset.value ? moment(targetInput.dataset.value, 'YYYY-MM-DD') : null;
                const monthStart = currentDate.clone().startOf('jMonth');
                const today = moment();

                // *** START: MODIFICATION to create a set of recorded period days ***
                const recordedPeriodDays = new Set();
                if (periodHistory) {
                    periodHistory.forEach(record => {
                        const start = moment(record.start_date, 'YYYY-MM-DD');
                        for (let i = 0; i < record.duration; i++) {
                            recordedPeriodDays.add(start.clone().add(i, 'days').format('YYYY-MM-DD'));
                        }
                    });
                }
                // *** END: MODIFICATION ***

                let html = `<div class="datepicker-header"><button class="p-2 rounded-full hover:bg-gray-100" onclick="window.app.changeDatePickerMonth(-1)">&lt;</button><span class="font-bold">${toPersian(currentDate.locale('fa').format('jMMMM jYYYY'))}</span><button class="p-2 rounded-full hover:bg-gray-100" onclick="window.app.changeDatePickerMonth(1)">&gt;</button></div><div class="grid grid-cols-7 text-center text-xs text-gray-500 mb-2">${['ش','ی','د','س','چ','پ','ج'].map(d=>`<span>${d}</span>`).join('')}</div><div class="datepicker-grid">`;
                for (let i = 0; i < monthStart.jDay(); i++) html += '<div></div>';
                for (let i = 1; i <= currentDate.jDaysInMonth(); i++) {
                    const dayMoment = currentDate.clone().jDate(i);
                    let classes = 'datepicker-day';
                    const isDisabled = dayMoment.isAfter(today, 'day');
                    if (isDisabled) classes += ' disabled';
                    if (dayMoment.isSame(today, 'day')) classes += ' today';
                    if (selectedDate && dayMoment.isSame(selectedDate, 'day')) classes += ' selected';

                    // *** START: MODIFICATION to add period-day class ***
                    const dayKey = dayMoment.format('YYYY-MM-DD');
                    if (recordedPeriodDays.has(dayKey)) {
                        classes += ' period-day';
                    }
                    // *** END: MODIFICATION ***

                    const clickHandler = isDisabled ? '' : `onclick="window.app.selectDate('${dayMoment.format('YYYY-MM-DD')}')"`;
                    html += `<div class="${classes}" ${clickHandler}>${toPersian(i)}</div>`;
                }
                html += `</div>`;
                datepickerModalContent.innerHTML = html;
            },
            // *** END: MODIFICATION ***
            changeDatePickerMonth(direction) {
                datepickerState.currentDate.add(direction, 'jMonth');
                this.renderDatePicker();
            },
            selectDate(dateStr) {
                const selectedMoment = moment(dateStr, 'YYYY-MM-DD');
                const targetInput = document.getElementById(datepickerState.targetInputId);
                targetInput.value = toPersian(selectedMoment.locale('fa').format('jYYYY/jM/jD'));
                targetInput.dataset.value = selectedMoment.format('YYYY-MM-DD');
                datepickerModal.classList.remove('visible');
            },
            openEditPeriodModal() {
                const deleteButton = userData.user.last_period_date
                    ? `<button id="delete-history-btn" class="flex items-center gap-1 text-xs bg-red-100 text-red-700 font-semibold px-2 py-1 rounded-md hover:bg-red-200 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                          <span>حذف</span>
                      </button>`
                    : '';
                const modalHeader = `<div class="flex items-center mb-6"><div class="flex-1 flex justify-start">${deleteButton}</div><div class="flex-shrink-0"><h3 class="text-xl font-bold">ثبت زمان پریود</h3></div><div class="flex-1"></div></div>`;
                // *** START: MODIFICATION to remove inline onclick ***
                const modalBody = `<div class="space-y-6"><div><label class="block text-gray-600 mb-2">تاریخ شروع خون‌ریزی</label><input type="text" id="edit-period-date-input" readonly class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg cursor-pointer"></div><div><div class="flex justify-between items-center mb-2"><label class="text-gray-600">طول دوره پریود (خون‌ریزی)</label><span id="edit-period-length-value" class="font-semibold text-pink-500"></span></div><input type="range" id="edit-period-length" min="2" max="12" step="1" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div></div>`;
                // *** END: MODIFICATION ***
                const modalFooter = `<div class="flex gap-4"><button onclick="window.app.savePeriodUpdate()" class="w-full bg-pink-500 text-white font-bold py-3 rounded-lg">ذخیره و تحلیل</button><button onclick="document.getElementById('edit-period-modal').classList.remove('visible')" class="w-full bg-gray-200 text-gray-700 font-bold py-3 rounded-lg">انصراف</button></div>`;
                editPeriodModalContent.innerHTML = `<div class="modal-body">${modalHeader}${modalBody}</div><div class="modal-footer">${modalFooter}</div>`;
                
                const dateInput = document.getElementById('edit-period-date-input');
                // *** START: MODIFICATION to add event listener programmatically ***
                dateInput.addEventListener('click', () => window.app.openDatePicker('edit-period-date-input', userData.period_history));
                // *** END: MODIFICATION ***

                const today = moment();
                dateInput.value = toPersian(today.locale('fa').format('jYYYY/jM/jD'));
                dateInput.dataset.value = today.locale('fa').format('YYYY-MM-DD');
                const lengthSlider = document.getElementById('edit-period-length');
                const lengthValueSpan = document.getElementById('edit-period-length-value');
                const currentPeriodLength = userData.user.avg_period_length ? Math.round(userData.user.avg_period_length) : userData.user.period_length;
                lengthSlider.value = currentPeriodLength;
                const updateSliderValue = () => { lengthValueSpan.textContent = `${toPersian(lengthSlider.value)} روز`; };
                lengthSlider.addEventListener('input', updateSliderValue);
                updateSliderValue();
                editPeriodModal.classList.add('visible');
            },
        };
        // --- EVENT LISTENERS ---
        settingsBtn.addEventListener('click', () => app.goToSettings());
        analysisBtn.addEventListener('click', () => app.goToAnalysis());
        backBtn.addEventListener('click', () => app.goToDashboard());
        logModal.addEventListener('click', (e) => {
            if (e.target.id === 'save-log-btn') window.app.saveLog();
            if (e.target.id === 'delete-log-btn') window.app.deleteLog();
            if (e.target.id === 'close-log-btn' || e.target.classList.contains('modal-overlay')) logModal.classList.remove('visible');
            const chip = e.target.closest('.symptom-chip');
            if (chip) {
                const { category } = chip.dataset;
                if (LOG_CONFIG[category].single) {
                    const wasSelected = chip.classList.contains('selected');
                    chip.parentElement.querySelectorAll('.symptom-chip').forEach(c => c.classList.remove('selected'));
                    if (!wasSelected) chip.classList.add('selected');
                } else {
                    chip.classList.toggle('selected');
                }
            }
        });
        datepickerModal.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) datepickerModal.classList.remove('visible');
        });
        editPeriodModal.addEventListener('click', (e) => {
            if (e.target.closest('#delete-history-btn')) {
                window.app.openDeletePeriodChoiceModal();
            }
            if (e.target.classList.contains('modal-overlay')) {
                editPeriodModal.classList.remove('visible');
            }
        });
        deleteChoiceModal.addEventListener('click', (e) => {
            if (e.target.id === 'delete-last-period-btn') {
                app.handleDeletePeriod('last');
            } else if (e.target.id === 'delete-all-periods-btn') {
                app.handleDeletePeriod('all');
            } else if (e.target.id === 'cancel-delete-choice-btn' || e.target.classList.contains('modal-overlay')) {
                deleteChoiceModal.classList.remove('visible');
            }
        });
        confirmationModal.addEventListener('click', (e) => {
             if (e.target.classList.contains('modal-overlay') || e.target.id === 'cancel-action-btn') {
                confirmationModal.classList.remove('visible');
            }
        });
        // --- START APP ---
        window.app.init();
    } catch (error) {
        console.error("An error occurred:", error);
        document.getElementById('app-content').innerHTML = `<div class="text-center text-red-500 p-8">یک خطای غیرمنتظره رخ داد. لطفاً صفحه را رفرش کنید.<br><small class="text-gray-400">${error.message}</small></div>`;
    }
});