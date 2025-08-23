// app.js

document.addEventListener('DOMContentLoaded', function() {
    try {
        // --- STATE & DOM ELEMENTS ---
        let userData = { user: null, logs: {}, period_history: [] };
        let calendarDate = moment();
        let selectedLogDate = null;
        let datepickerState = { visible: false, targetInputId: null, currentDate: moment() };
        let charts = {}; // To hold chart instances

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

        // --- TOAST NOTIFICATION ---
        const toast = document.createElement('div');
        toast.style.cssText = 'position: fixed; bottom: -100px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: white; font-weight: 500; transition: bottom 0.5s ease-in-out; z-index: 100;';
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
        
        // --- MODIFIED --- This function is now corrected to avoid the TypeError.
        const showConfirmationModal = (title, message, onConfirm) => {
            document.getElementById('confirmation-title').textContent = title;
            document.getElementById('confirmation-message').textContent = message;
            
            let currentConfirmBtn = document.getElementById('confirm-action-btn');
            const newConfirmBtn = currentConfirmBtn.cloneNode(true);
            
            // Replace the old button with the clone to safely remove previous event listeners.
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

            /**
             * Initializes the application by fetching user data.
             * @param {boolean} refreshOnly - If true, only fetches data without re-rendering the initial page.
             */
            async init(refreshOnly = false) {
                moment.locale('fa');
                try {
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
                        appContent.innerHTML = `<div class="text-center text-red-500 p-8">ارتباط با سرور برقرار نشد. لطفاً از روشن بودن سرور اطمینان حاصل کرده و صفحه را رفرش کنید.</div>`;
                    }
                    showToast(error.message, true);
                }
            },

            /**
             * Handles the multi-step onboarding process.
             * @param {number} step - The current step in the onboarding flow.
             */
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
                    try {
                        const response = await fetch(`${API_BASE_URL}/onboarding`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(this.onboardingData)
                        });
                        const data = await response.json();
                        if (!response.ok && response.status !== 201) {
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
            
            /**
             * Saves the user's updated settings.
             */
            async saveSettings() {
                const settingsData = {
                    cycle_length: document.getElementById('settings-cycle-length').value,
                    period_length: document.getElementById('settings-period-length').value,
                    birth_year: document.getElementById('settings-birth-year').value,
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

            /**
             * Saves or updates the daily log for the selected date.
             */
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

            /**
             * Deletes the daily log for the selected date.
             */
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

            /**
             * Submits a new or updated period record.
             */
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
                    
                    userData.user = data.user;
                    await this.init(true); // Refresh data
                    
                    showToast(data.message);
                    editPeriodModal.classList.remove('visible');
                    renderDashboard(userData);
                } catch (error) {
                    console.error('Failed to update period data:', error);
                    showToast(error.message, true);
                }
            },
            
            // --- Deletes all period history
            async deletePeriodHistory() {
                 showConfirmationModal(
                    'حذف تمام سوابق پریود',
                    'آیا مطمئن هستید؟ با این کار تمام تاریخچه پریود شما حذف شده و محاسبات از نو انجام خواهد شد. این عمل غیرقابل بازگشت است.',
                    async () => {
                        try {
                            const response = await fetch(`${API_BASE_URL}/user/${TELEGRAM_ID}/period`, {
                                method: 'DELETE'
                            });
                            const data = await response.json();
                            if (!response.ok) throw new Error(data.error || 'خطا در حذف سوابق');

                            // Update local state to reflect the deletion
                            userData.user = data.user;
                            userData.period_history = [];
                            
                            showToast(data.message);
                            editPeriodModal.classList.remove('visible');
                            renderDashboard(userData);
                        } catch (error) {
                            console.error('Failed to delete period history:', error);
                            showToast(error.message, true);
                        }
                    }
                );
            },

            // --- UI Interaction Methods ---
            goToSettings() { renderSettings(userData); },
            goToAnalysis() { renderAnalysis(userData, charts); },
            goToDashboard() { renderDashboard(userData); },
            changeMonth(direction) { calendarDate.add(direction, 'jMonth'); this.renderCalendar(calendarDate); },
            renderCalendar(date) { calendarDate = date; renderCalendar(calendarDate, userData); },
            logToday() { const todayStr = moment().format('YYYY-MM-DD'); this.openLogModal(todayStr); },

            goToToday() {
                calendarDate = moment();
                this.renderCalendar(calendarDate);

                // Add heartbeat animation to today's element in the calendar
                setTimeout(() => {
                    const todayEl = document.querySelector('#calendar-grid .today');
                    if (todayEl) {
                        todayEl.classList.add('animate-heartbeat');
                        // Remove the class after the animation finishes to allow re-triggering
                        setTimeout(() => {
                            todayEl.classList.remove('animate-heartbeat');
                        }, 2000); // Animation duration is 2s
                    }
                }, 50); // A small delay to ensure the DOM is updated
            },

            /**
             * Opens the log modal for a specific date.
             * @param {string} dateKey - The date string in 'YYYY-MM-DD' format.
             */
            openLogModal(dateKey) {
                selectedLogDate = dateKey;
                const hasLog = userData.logs[selectedLogDate] && Object.keys(userData.logs[selectedLogDate]).length > 0;
                
                let modalBodyHTML = `<div class="flex justify-between items-center mb-4"><button id="delete-log-btn" class="text-red-500 hover:text-red-700 text-sm font-semibold ${hasLog ? '' : 'invisible'}">حذف علائم</button><h3 class="text-xl font-bold text-center">ثبت علائم</h3><div class="w-16"></div></div><p class="text-center text-gray-500 mb-4 -mt-4">${toPersian(moment(dateKey, 'YYYY-MM-DD').format('dddd jD jMMMM'))}</p><div class="space-y-4">`;
                const currentLog = userData.logs[selectedLogDate] || {};

                for (const categoryKey in LOG_CONFIG) {
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
                }
                modalBodyHTML += `<div><div class="flex justify-between items-center mb-2"><h4 class="font-semibold text-gray-600">توضیحات دیگر</h4><span id="notes-char-count" class="text-xs text-gray-400"></span></div><textarea id="log-notes" class="w-full p-2 border rounded-lg bg-gray-50" rows="3" maxlength="500" oninput="document.getElementById('notes-char-count').textContent = toPersian(this.value.length) + ' / ' + toPersian(500)">${currentLog.notes || ''}</textarea></div></div>`;
                const modalFooterHTML = `<div class="flex gap-4"><button id="save-log-btn" class="w-full bg-pink-500 text-white font-bold py-3 rounded-lg">ذخیره</button><button id="close-log-btn" class="w-full bg-gray-200 text-gray-700 font-bold py-3 rounded-lg">انصراف</button></div>`;
                
                logModalContent.innerHTML = `<div class="modal-body">${modalBodyHTML}</div><div class="modal-footer">${modalFooterHTML}</div>`;
                logModal.classList.add('visible');
                document.getElementById('log-notes').dispatchEvent(new Event('input'));
            },

            openDatePicker(targetInputId) {
                const targetInput = document.getElementById(targetInputId);
                const initialDate = targetInput.dataset.value ? moment(targetInput.dataset.value, 'YYYY-MM-DD') : moment();
                datepickerState.targetInputId = targetInputId;
                datepickerState.currentDate = initialDate.clone();
                this.renderDatePicker();
                datepickerModal.classList.add('visible');
            },

            renderDatePicker() {
                const { currentDate, targetInputId } = datepickerState;
                const targetInput = document.getElementById(targetInputId);
                const selectedDate = targetInput.dataset.value ? moment(targetInput.dataset.value, 'YYYY-MM-DD') : null;
                const monthStart = currentDate.clone().startOf('jMonth');
                const today = moment();
                let html = `<div class="datepicker-header"><button class="p-2 rounded-full hover:bg-gray-100" onclick="window.app.changeDatePickerMonth(-1)">&lt;</button><span class="font-bold">${toPersian(currentDate.format('jMMMM jYYYY'))}</span><button class="p-2 rounded-full hover:bg-gray-100" onclick="window.app.changeDatePickerMonth(1)">&gt;</button></div><div class="grid grid-cols-7 text-center text-xs text-gray-500 mb-2">${['ش','ی','د','س','چ','پ','ج'].map(d=>`<span>${d}</span>`).join('')}</div><div class="datepicker-grid">`;
                for (let i = 0; i < monthStart.jDay(); i++) html += '<div></div>';
                for (let i = 1; i <= currentDate.jDaysInMonth(); i++) {
                    const dayMoment = currentDate.clone().jDate(i);
                    let classes = 'datepicker-day';
                    const isDisabled = dayMoment.isAfter(today, 'day');
                    if (isDisabled) classes += ' disabled';
                    if (dayMoment.isSame(today, 'day')) classes += ' today';
                    if (selectedDate && dayMoment.isSame(selectedDate, 'day')) classes += ' selected';
                    const clickHandler = isDisabled ? '' : `onclick="window.app.selectDate('${dayMoment.format('YYYY-MM-DD')}')"`;
                    html += `<div class="${classes}" ${clickHandler}>${toPersian(i)}</div>`;
                }
                html += `</div>`;
                datepickerModalContent.innerHTML = html;
            },

            changeDatePickerMonth(direction) {
                datepickerState.currentDate.add(direction, 'jMonth');
                this.renderDatePicker();
            },

            selectDate(dateStr) {
                const selectedMoment = moment(dateStr, 'YYYY-MM-DD');
                const targetInput = document.getElementById(datepickerState.targetInputId);
                targetInput.value = toPersian(selectedMoment.format('jYYYY/jM/jD'));
                targetInput.dataset.value = selectedMoment.format('YYYY-MM-DD');
                datepickerModal.classList.remove('visible');
            },

            // --- MODIFIED --- The button is now more compact to fit on mobile screens with its text.
            openEditPeriodModal() {
                // Conditionally create the delete button with new, more compact styles.
                const deleteButton = userData.user.last_period_date
                    ? `<button id="delete-history-btn" class="flex items-center gap-1 text-xs bg-red-100 text-red-700 font-semibold px-2 py-1 rounded-md hover:bg-red-200 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                          </svg>
                          <span>حذف</span>
                      </button>`
                    : '';

                // A robust flex layout that works on all screen sizes.
                const modalHeader = `
                    <div class="flex items-center mb-6">
                        <div class="flex-1 flex justify-start">${deleteButton}</div>
                        <div class="flex-shrink-0"><h3 class="text-xl font-bold">ثبت زمان پریود</h3></div>
                        <div class="flex-1"></div>
                    </div>
                `;
                
                const modalBody = `<div class="space-y-6"><div><label class="block text-gray-600 mb-2">تاریخ شروع خون‌ریزی</label><input type="text" id="edit-period-date-input" readonly class="w-full p-3 bg-gray-100 rounded-lg text-center text-lg cursor-pointer" onclick="window.app.openDatePicker('edit-period-date-input')"></div><div><div class="flex justify-between items-center mb-2"><label class="text-gray-600">طول دوره پریود (خون‌ریزی)</label><span id="edit-period-length-value" class="font-semibold text-pink-500"></span></div><input type="range" id="edit-period-length" min="2" max="12" step="1" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div></div>`;
                const modalFooter = `<div class="flex gap-4"><button onclick="window.app.savePeriodUpdate()" class="w-full bg-pink-500 text-white font-bold py-3 rounded-lg">ذخیره و تحلیل</button><button onclick="document.getElementById('edit-period-modal').classList.remove('visible')" class="w-full bg-gray-200 text-gray-700 font-bold py-3 rounded-lg">انصراف</button></div>`;
                editPeriodModalContent.innerHTML = `<div class="modal-body">${modalHeader}${modalBody}</div><div class="modal-footer">${modalFooter}</div>`;

                const dateInput = document.getElementById('edit-period-date-input');
                const today = moment();
                dateInput.value = toPersian(today.format('jYYYY/jM/jD'));
                dateInput.dataset.value = today.format('YYYY-MM-DD');
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
            if (e.target.closest('#delete-history-btn')) { // Use closest to handle clicks on svg/span inside the button
                window.app.deletePeriodHistory();
            }
            if (e.target.classList.contains('modal-overlay')) {
                editPeriodModal.classList.remove('visible');
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