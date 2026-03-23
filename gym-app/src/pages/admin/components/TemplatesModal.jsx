/**
 * Template selector modal for creating new programs.
 * Includes a templates gallery tab and an auto-generate tab.
 */
import { useState } from 'react';
import { LayoutTemplate, Sparkles } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { PROGRAM_TEMPLATES, GOAL_BADGE } from './programHelpers';

const pickTemplate = (goal, level, days) => {
  if (level === 'Beginner') return PROGRAM_TEMPLATES.find(t => t.id === 'full_body');
  if (goal === 'Fat Loss')  return PROGRAM_TEMPLATES.find(t => t.id === 'full_body');
  if (level === 'Intermediate') {
    if (goal === 'Strength') return PROGRAM_TEMPLATES.find(t => t.id === 'strength_531');
    if (goal === 'Muscle Gain' && days >= 5) return PROGRAM_TEMPLATES.find(t => t.id === 'ppl');
    if (goal === 'Muscle Gain') return PROGRAM_TEMPLATES.find(t => t.id === 'upper_lower');
    return PROGRAM_TEMPLATES.find(t => t.id === 'upper_lower');
  }
  if (level === 'Advanced') {
    if (goal === 'Strength') return PROGRAM_TEMPLATES.find(t => t.id === 'strength_531');
    if (goal === 'Muscle Gain') return days >= 6
      ? PROGRAM_TEMPLATES.find(t => t.id === 'bro_split')
      : PROGRAM_TEMPLATES.find(t => t.id === 'ppl');
    return PROGRAM_TEMPLATES.find(t => t.id === 'ppl');
  }
  return PROGRAM_TEMPLATES.find(t => t.id === 'full_body');
};

export default function TemplatesModal({ onClose, onSelect, onStartFromScratch }) {
  const [tab, setTab] = useState('templates');
  const [genGoal, setGenGoal]   = useState('Muscle Gain');
  const [genLevel, setGenLevel] = useState('Intermediate');
  const [genDays, setGenDays]   = useState(4);

  const handleGenerate = () => {
    const match = pickTemplate(genGoal, genLevel, Number(genDays));
    if (match) onSelect(match);
  };

  return (
    <AdminModal
      isOpen
      onClose={onClose}
      title="New Program"
      size="lg"
    >
      {/* Start from scratch link */}
      {onStartFromScratch && (
        <div className="flex justify-end -mt-2 mb-3">
          <button
            onClick={onStartFromScratch}
            className="text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            Start from scratch
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab('templates')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
            tab === 'templates'
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/4'
          }`}
        >
          <LayoutTemplate size={13} /> Templates
        </button>
        <button
          onClick={() => setTab('generate')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
            tab === 'generate'
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'text-[#6B7280] hover:text-[#9CA3AF] hover:bg-white/4'
          }`}
        >
          <Sparkles size={13} /> Auto-generate
        </button>
      </div>

      {/* Templates tab */}
      {tab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROGRAM_TEMPLATES.map(t => {
            const totalDays = t.weekPattern.length;
            return (
              <div key={t.id} className="bg-[#111827] border border-white/6 rounded-2xl p-4 flex flex-col gap-3">
                <div>
                  <p className="text-[14px] font-bold text-[#E5E7EB] mb-2">{t.name}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${GOAL_BADGE[t.goal] ?? 'bg-white/8 text-[#9CA3AF]'}`}>
                      {t.goal}
                    </span>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/8 text-[#9CA3AF]">
                      {t.level}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#4B5563]">
                    {t.daysPerWeek} days/week · {t.durationWeeks} weeks · {totalDays * t.durationWeeks} days total
                  </p>
                </div>
                <p className="text-[12px] text-[#6B7280] leading-relaxed flex-1">{t.description}</p>
                <button
                  onClick={() => onSelect(t)}
                  className="w-full py-2 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors"
                >
                  Use Template
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Auto-generate tab */}
      {tab === 'generate' && (
        <div className="max-w-sm mx-auto space-y-5 pt-2">
          <p className="text-[13px] text-[#6B7280]">
            Tell us your goal and we'll pick the best matching template to pre-fill a new program.
          </p>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Goal</label>
            <select
              value={genGoal}
              onChange={e => setGenGoal(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
            >
              <option>Muscle Gain</option>
              <option>Strength</option>
              <option>Fat Loss</option>
              <option>General Fitness</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Experience Level</label>
            <select
              value={genLevel}
              onChange={e => setGenLevel(e.target.value)}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
            >
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Advanced</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">Days Per Week</label>
            <select
              value={genDays}
              onChange={e => setGenDays(Number(e.target.value))}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
            >
              <option value={3}>3 days</option>
              <option value={4}>4 days</option>
              <option value={5}>5 days</option>
              <option value={6}>6 days</option>
            </select>
          </div>

          {/* Preview matched template */}
          {(() => {
            const match = pickTemplate(genGoal, genLevel, genDays);
            return match ? (
              <div className="bg-[#111827] border border-white/6 rounded-xl p-3.5">
                <p className="text-[11px] font-bold text-[#4B5563] uppercase tracking-widest mb-2">Best match</p>
                <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1">{match.name}</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${GOAL_BADGE[match.goal] ?? 'bg-white/8 text-[#9CA3AF]'}`}>
                    {match.goal}
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/8 text-[#9CA3AF]">
                    {match.level}
                  </span>
                </div>
                <p className="text-[11px] text-[#4B5563]">
                  {match.daysPerWeek} days/week · {match.durationWeeks} weeks
                </p>
              </div>
            ) : null;
          })()}

          <button
            onClick={handleGenerate}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors"
          >
            Generate Program
          </button>
        </div>
      )}
    </AdminModal>
  );
}
