const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src/pages/email-intelligence/TasksCalendar.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Remove [+] [+] buttons from grid header
content = content.replace(
  /<div className="flex justify-center gap-1">\s*<span className="w-3 h-3 border border-gray-300 rounded-sm text-\[8px\] text-gray-400 flex items-center justify-center">\+<\/span>\s*<span className="w-3 h-3 border border-gray-300 rounded-sm text-\[8px\] text-gray-400 flex items-center justify-center">\+<\/span>\s*<\/div>/g,
  ''
);

// 2. Enhance container styling
content = content.replace(
  'className="flex bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px]"',
  'className="flex bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-200 overflow-hidden min-h-[600px] transition-all duration-300"'
);

// 3. Enhance Header styling
content = content.replace(
  'className="flex border border-gray-300 rounded overflow-hidden shadow-sm"',
  'className="flex items-center bg-gray-100/80 p-1 rounded-xl shadow-inner border border-gray-200/60"'
);
content = content.replace(
  'className="px-2.5 py-1.5 bg-white hover:bg-gray-50 border-r border-gray-300 text-gray-600 transition-colors">&lt;</button>',
  'className="px-3 py-1.5 bg-transparent hover:bg-white rounded-md text-gray-600 transition-all font-medium text-sm">&lt;</button>'
);
content = content.replace(
  'className="px-4 py-1.5 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors">Today</button>',
  'className="px-4 py-1.5 mx-1 bg-white shadow-sm rounded-md text-sm font-semibold text-gray-800 transition-all">Today</button>'
);
content = content.replace(
  'className="px-2.5 py-1.5 bg-white hover:bg-gray-50 border-l border-gray-300 text-gray-600 transition-colors">&gt;</button>',
  'className="px-3 py-1.5 bg-transparent hover:bg-white rounded-md text-gray-600 transition-all font-medium text-sm">&gt;</button>'
);

// 4. Enhance Grid Header
content = content.replace(
  'className="flex border-b border-gray-200 bg-white min-w-max sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"',
  'className="flex border-b border-gray-200 bg-gray-50/95 backdrop-blur-sm min-w-max sticky top-0 z-20 shadow-sm"'
);
content = content.replace(
  'className="w-56 shrink-0 border-r border-gray-200 p-3 text-[11px] font-bold text-gray-500 uppercase flex items-center justify-between bg-white sticky left-0 z-30"',
  'className="w-64 shrink-0 border-r border-gray-200 p-4 text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center justify-between bg-gray-50/95 backdrop-blur-sm sticky left-0 z-30"'
);
content = content.replace(
  /<div className="text-\[11px\] font-bold text-gray-500 uppercase tracking-wider mb-0\.5">\{format\(day, 'EEE d'\)\}<\/div>/g,
  '<div className={`text-xs font-bold uppercase tracking-widest ${isToday(day) ? "text-blue-600 bg-blue-50 py-1 rounded-md" : "text-gray-500"}`}>{format(day, \'EEE d\')}</div>'
);

// 5. Enhance User Column
content = content.replace(
  'className="w-56 shrink-0 border-r border-gray-200 p-2.5 px-3 flex items-center gap-3 bg-white group-hover:bg-gray-50/70 transition-colors sticky left-0 z-10 shadow-[1px_0_2px_rgba(0,0,0,0.02)] cursor-pointer"',
  'className="w-64 shrink-0 border-r border-gray-200 p-4 px-5 flex items-center gap-4 bg-white group-hover:bg-gray-50/80 transition-all sticky left-0 z-10 shadow-[2px_0_4px_rgba(0,0,0,0.02)] cursor-pointer relative after:absolute after:inset-y-0 after:right-0 after:w-[3px] after:bg-blue-500 after:opacity-0 hover:after:opacity-100"'
);

// 6. Enhance Shift Cards
content = content.replace(
  /className=\{`rounded-md p-1\.5 px-2 mb-1 text-\[11px\] text-white font-medium cursor-pointer shadow-sm \$\{t\.status === 'completed' \? 'bg-gray-400 opacity-60' : shiftColor\} flex flex-col justify-center leading-tight hover:brightness-110 transition-all border-l-4 border-white\/20`\}/g,
  'className={`rounded-lg p-2.5 mb-2 text-[11px] text-white font-medium cursor-pointer shadow-sm ${t.status === \'completed\' ? \'bg-gray-400 opacity-60\' : shiftColor} flex flex-col justify-center leading-relaxed hover:shadow-md hover:-translate-y-0.5 transform transition-all duration-200 border-l-4 border-white/30 backdrop-blur-sm bg-opacity-95`}'
);

content = content.replace(
  /<div className="truncate font-bold">\{t\.title\}<\/div>\s*<div className="truncate uppercase opacity-90 text-\[9px\] mt-0\.5 tracking-wider">\{t\.status\}<\/div>/g,
  '<div className="truncate font-semibold text-xs drop-shadow-sm">{t.title}</div><div className="truncate uppercase text-white/80 text-[9px] mt-1 tracking-widest font-bold">{t.status}</div>'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Successfully improved UI.");
