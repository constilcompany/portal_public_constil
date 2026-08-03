const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src/pages/email-intelligence/TasksCalendar.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const MOCK_DATA = `
const MOCK_USERS = [
  { id: 1, name: 'Abbie Janssen', role: '32', initial: 'A', color: 'bg-pink-100 text-pink-700' },
  { id: 2, name: 'Al Hollie', role: '32', initial: 'A', color: 'bg-blue-100 text-blue-700' },
  { id: 3, name: 'Andrea Kinzinger', role: '32', initial: 'A', color: 'bg-green-100 text-green-700' },
  { id: 4, name: 'Arjun Patel', role: '40', initial: 'A', color: 'bg-orange-100 text-orange-700' },
  { id: 5, name: 'Chris Lovely', role: '40', initial: 'C', color: 'bg-purple-100 text-purple-700' },
  { id: 6, name: 'Daniel Kim', role: '40', initial: 'D', color: 'bg-teal-100 text-teal-700' },
  { id: 7, name: 'Dave Croke', role: '32', initial: 'D', color: 'bg-indigo-100 text-indigo-700' },
];

const POSITIONS = ['CASHIER', 'SUPERVISOR', 'MANAGER', 'ASSOCIATE'];
const POSITIONS_COLORS = [
  'bg-pink-600', // Cashier
  'bg-green-600', // Supervisor
  'bg-blue-500', // Manager
  'bg-amber-600', // Associate
  'bg-purple-600'
];

`;

// Insert MOCK_DATA after imports
const lastImportIdx = content.lastIndexOf('import');
const endOfLastImport = content.indexOf('\n', lastImportIdx);
content = content.slice(0, endOfLastImport + 1) + MOCK_DATA + content.slice(endOfLastImport + 1);

const startComment = `        /* CALENDAR VIEW */`;
const startIdx = content.indexOf(startComment);

// Find the end of CALENDAR VIEW. It ends right before `      )}` which is followed by `{/* Task Modal (Calendar click) */}`
const endIdx = content.indexOf(`      {/* Task Modal (Calendar click) */}`, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  // Replace the chunk
  const replacement = `        /* CALENDAR VIEW (RESOURCE SCHEDULER) */
        <div className="flex bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px]">
          {/* Sidebar */}
          <div className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col hidden md:flex shrink-0">
            <div className="p-4 border-b border-gray-200">
              <button className="w-full bg-green-600 hover:bg-green-700 text-white rounded-lg p-3 text-left shadow-sm transition-colors flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">Publish & Notify</div>
                  <div className="text-xs text-green-100">6 shifts</div>
                </div>
                <CalendarIcon className="w-4 h-4 opacity-80" />
              </button>
            </div>
            
            <div className="p-4 space-y-6 flex-1 overflow-y-auto">
              <div>
                <h4 className="text-xs font-semibold text-gray-900 mb-3 uppercase tracking-wider">Filters</h4>
                <div className="space-y-2">
                  {['Positions', 'Job Sites', 'User', 'Tags'].map(filter => (
                    <div key={filter} className="flex items-center justify-between p-2 hover:bg-gray-100 rounded-md cursor-pointer text-sm text-gray-700 border border-transparent hover:border-gray-200 transition-all">
                      <span className="flex items-center gap-3">
                        <span className="w-4 h-4 flex items-center justify-center text-gray-400">
                          {filter === 'Positions' && <div className="w-3 h-3 rounded-sm border border-gray-400" />}
                          {filter === 'Job Sites' && <div className="w-3 h-3 rounded-full border border-gray-400" />}
                          {filter === 'User' && <div className="w-3 h-3 rounded-sm border border-gray-400" />}
                          {filter === 'Tags' && <div className="w-3 h-3 rounded-sm border border-gray-400" />}
                        </span>
                        {filter}
                      </span>
                      <span className="text-gray-400 text-xs text-right opacity-50">v</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-xs font-semibold text-gray-900 mb-3 uppercase tracking-wider">More tools</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 text-sm text-gray-700">
                    <span className="flex items-center gap-3">
                      <span className="w-4 h-4 flex items-center justify-center text-gray-400"><div className="w-3 h-3 rounded-sm border border-gray-400" /></span>
                      Forecast tools
                    </span>
                    <div className="w-8 h-4 bg-gray-300 rounded-full relative cursor-pointer"><div className="w-3 h-3 bg-white rounded-full absolute left-0.5 top-0.5 shadow"></div></div>
                  </div>
                  {['Display options', 'Task lists'].map(tool => (
                    <div key={tool} className="flex items-center justify-between p-2 hover:bg-gray-100 rounded-md cursor-pointer text-sm text-gray-700">
                      <span className="flex items-center gap-3">
                        <span className="w-4 h-4 flex items-center justify-center text-gray-400"><div className="w-3 h-3 rounded-sm border border-gray-400" /></span>
                        {tool}
                      </span>
                      <span className="text-gray-400 text-xs text-right opacity-50">v</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Main Calendar Area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-x-auto bg-gray-50/30">
            <div className="p-3 px-5 border-b border-gray-200 flex items-center justify-between bg-white sticky left-0 right-0">
              <div className="flex items-center gap-4">
                <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">
                  {format(currentDate, 'MMM d')} – {format(addDays(currentDate, 6), 'MMM d')}
                </h2>
                <div className="flex border border-gray-300 rounded overflow-hidden shadow-sm">
                  <button onClick={() => setCurrentDate(addDays(currentDate, -7))} className="px-2.5 py-1.5 bg-white hover:bg-gray-50 border-r border-gray-300 text-gray-600 transition-colors">&lt;</button>
                  <button onClick={() => setCurrentDate(new Date())} className="px-4 py-1.5 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors">Today</button>
                  <button onClick={() => setCurrentDate(addDays(currentDate, 7))} className="px-2.5 py-1.5 bg-white hover:bg-gray-50 border-l border-gray-300 text-gray-600 transition-colors">&gt;</button>
                </div>
              </div>
              
              <div className="flex items-center gap-3 text-[13px] text-gray-500">
                <div className="flex items-center gap-1.5">Viewing <span className="font-semibold text-gray-800 cursor-pointer hover:text-blue-600 transition-colors">Downtown</span><span className="text-[10px] opacity-60">v</span></div>
                <span className="text-gray-300">|</span>
                <div className="flex items-center gap-1.5">by <span className="font-semibold text-gray-800 cursor-pointer hover:text-blue-600 transition-colors">Week</span><span className="text-[10px] opacity-60">v</span></div>
                <span className="text-gray-300">|</span>
                <div className="flex items-center gap-1.5">as <span className="font-semibold text-gray-800 cursor-pointer hover:text-blue-600 transition-colors">Users</span><span className="text-[10px] opacity-60">v</span></div>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto">
              {/* Grid Header */}
              <div className="flex border-b border-gray-200 bg-white min-w-max sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div className="w-56 shrink-0 border-r border-gray-200 p-3 text-[11px] font-bold text-gray-500 uppercase flex items-center justify-between bg-white sticky left-0 z-30">
                  First Name <span className="text-[10px] opacity-50">v</span>
                </div>
                {Array.from({length: 7}).map((_, i) => {
                  const day = addDays(currentDate, i);
                  return (
                    <div key={i} className="flex-1 min-w-[140px] p-2 border-r border-gray-200 text-center">
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">{format(day, 'EEE d')}</div>
                      <div className="flex justify-center gap-1">
                        <span className="w-3 h-3 border border-gray-300 rounded-sm text-[8px] text-gray-400 flex items-center justify-center">+</span>
                        <span className="w-3 h-3 border border-gray-300 rounded-sm text-[8px] text-gray-400 flex items-center justify-center">+</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Grid Body */}
              <div className="min-w-max">
                {/* OpenShifts Row */}
                <div className="flex border-b border-gray-200 bg-[#f8faf7] transition-colors group">
                  <div className="w-56 shrink-0 border-r border-gray-200 p-2 px-3 flex items-center gap-2 bg-[#f8faf7] sticky left-0 z-10 shadow-[1px_0_2px_rgba(0,0,0,0.02)]">
                    <div className="w-6 h-6 rounded bg-green-100 border border-green-200 flex items-center justify-center text-green-700 font-bold text-[10px]">O</div>
                    <div className="text-sm font-semibold text-green-800 flex-1">OpenShifts</div>
                    <span className="text-[10px] opacity-50">v</span>
                  </div>
                  {Array.from({length: 7}).map((_, j) => {
                    const hasOpenShift = j === 1 || j === 4;
                    return (
                      <div key={j} className="flex-1 min-w-[140px] p-1.5 border-r border-gray-200 relative min-h-[50px]">
                        {hasOpenShift && (
                          <div className={\`rounded-md p-1.5 px-2 text-[11px] text-white font-medium cursor-pointer shadow-sm bg-purple-600 flex flex-col justify-center leading-tight hover:brightness-110 transition-all border-l-4 border-white/20\`}>
                            <div className="truncate font-bold">3p - 11p</div>
                            <div className="truncate uppercase opacity-90 text-[9px] mt-0.5 tracking-wider">CASHIER</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Users Rows */}
                {MOCK_USERS.map((user, i) => (
                  <div key={user.id} className="flex border-b border-gray-200 hover:bg-gray-50/70 transition-colors group bg-white">
                    {/* User Column */}
                    <div className="w-56 shrink-0 border-r border-gray-200 p-2.5 px-3 flex items-center gap-3 bg-white group-hover:bg-gray-50/70 transition-colors sticky left-0 z-10 shadow-[1px_0_2px_rgba(0,0,0,0.02)]">
                      <div className={\`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm \${user.color}\`}>
                        {user.initial}
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-gray-900 leading-tight">{user.name}</div>
                        <div className="text-[11px] text-gray-500 font-medium">{user.role} <span className="opacity-70">hrs</span></div>
                      </div>
                    </div>
                    
                    {/* Days Columns */}
                    {Array.from({length: 7}).map((_, j) => {
                      const day = addDays(currentDate, j);
                      // Randomly assign shifts for demonstration matching the image
                      let hasShift = false;
                      let shiftTime = '9a - 5p';
                      let shiftPos = POSITIONS[(i+j) % POSITIONS.length];
                      let shiftColor = POSITIONS_COLORS[(i+j) % POSITIONS_COLORS.length];
                      
                      if (i === 0 && (j === 0 || j === 3 || j === 4)) {
                        hasShift = true;
                        shiftColor = 'bg-pink-600';
                        shiftPos = 'CASHIER';
                      }
                      if (i === 1 && (j >= 0 && j <= 2)) {
                        hasShift = true;
                        shiftTime = '11a - 7p';
                        shiftPos = 'SUPERVISOR';
                        shiftColor = 'bg-[#6b9c65]'; // Custom green to match image
                      }
                      if (i === 2 && (j >= 1 && j <= 6)) {
                        hasShift = true;
                        shiftTime = j===1 ? '5p - 11p' : '9a - 5p';
                        shiftPos = j===1 ? 'MANAGER' : 'MANAGER';
                        shiftColor = 'bg-blue-400';
                      }
                      if (i === 3 && (j >= 2 && j <= 6)) {
                        hasShift = true;
                        shiftTime = '3p - 11p';
                        shiftPos = 'CASHIER';
                        shiftColor = 'bg-purple-600';
                      }
                      if (i === 4 && (j >= 2 && j <= 6)) {
                        hasShift = true;
                        shiftTime = j > 3 ? '3p - 11p' : '11a - 7p';
                        shiftPos = 'ASSOCIATE';
                        shiftColor = 'bg-[#a3792c]'; // Custom brown/amber
                      }
                      if (i === 5 && (j >= 1 && j <= 4)) {
                        hasShift = true;
                        shiftTime = '3p - 11p';
                        shiftPos = 'MANAGER';
                        shiftColor = 'bg-blue-600';
                      }
                      if (i === 6 && (j === 0 || j === 4 || j === 5)) {
                        hasShift = true;
                        shiftTime = '3p - 11p';
                        shiftPos = 'CASHIER';
                        shiftColor = 'bg-purple-600';
                      }

                      return (
                        <div key={j} className="flex-1 min-w-[140px] p-1.5 border-r border-gray-200 relative min-h-[60px] group-hover:bg-gray-50/30 transition-colors">
                          {hasShift && (
                            <div 
                              className={\`rounded-md p-1.5 px-2 text-[11px] text-white font-medium cursor-pointer shadow-sm \${shiftColor} flex flex-col justify-center leading-tight hover:brightness-110 transition-all border-l-4 border-white/20\`}
                              title={\`\${shiftTime} \${shiftPos}\`}
                            >
                              <div className="truncate font-bold">{shiftTime}</div>
                              <div className="truncate uppercase opacity-90 text-[9px] mt-0.5 tracking-wider">{shiftPos}</div>
                            </div>
                          )}
                          
                          {/* Corner marker */}
                          {hasShift && (
                            <div className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-r-[8px] border-t-white border-r-transparent opacity-50 mix-blend-overlay"></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
`;

  // Actually the block is from startIdx up to endIdx (exclusive of `{/* Task Modal (Calendar click) */}`)
  // but wait, there's `      )}` which belongs to `viewMode === 'list' ? ... : ...`
  // so we need to be careful. The endIdx is `      {/* Task Modal (Calendar click) */}`
  // Let's grab the `      )}` before it.
  
  const actualEndIdx = content.lastIndexOf('      )}', endIdx);
  
  content = content.slice(0, startIdx) + replacement + content.slice(actualEndIdx);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log("Successfully updated TasksCalendar.tsx");
} else {
  console.error("Could not find CALENDAR VIEW block");
}
