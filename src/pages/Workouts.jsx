import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play, Plus, Dumbbell, Clock, ChevronRight, Pencil, BookOpen, Users, X
} from 'lucide-react';

const mockCustomWorkouts = [
  { id: 'cw1', name: 'Push Day (Hypertrophy)', exercises: 3, lastPerformed: '2 days ago' },
  { id: 'cw2', name: 'Pull & Abs',             exercises: 4, lastPerformed: '4 days ago' },
  { id: 'cw3', name: 'Leg Day Annihilation',   exercises: 5, lastPerformed: '5 days ago' },
];

const mockGymPrograms = [
  {
    id: 'gp1',
    name: 'IronForge Powerbuilding',
    subtitle: 'Phase 1 of 3',
    instructor: 'Coach Sarah',
    duration: '8 weeks',
    level: 'Intermediate',
    enrolled: 142,
    accent: '#D4AF37',
  },
  {
    id: 'gp2',
    name: 'Summer Shred',
    subtitle: 'Fat loss + strength',
    instructor: 'Coach Mike',
    duration: '6 weeks',
    level: 'All Levels',
    enrolled: 89,
    accent: '#3B82F6',
  },
];

const Workouts = () => {
  const [activeTab, setActiveTab] = useState('my-routines');
  const [routines, setRoutines] = useState([...mockCustomWorkouts]);
  const [isCreating, setIsCreating] = useState(false);
  const [newRoutineName, setNewRoutineName] = useState('');

  const handleCreateRoutine = (e) => {
    e.preventDefault();
    if (!newRoutineName.trim()) return;
    setRoutines([
      { id: `cw${Date.now()}`, name: newRoutineName, exercises: 0, lastPerformed: 'Never' },
      ...routines,
    ]);
    setNewRoutineName('');
    setIsCreating(false);
  };

  return (
    <div className="container main-content animate-fade-in pb-24 md:pb-8">

      {/* Page header */}
      <header className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">Workouts</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">Your routines and gym programs.</p>
      </header>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setIsCreating(true)}
          className="flex flex-col items-center justify-center gap-3 bg-[#0F172A] hover:bg-[#111827] border border-white/6 hover:border-white/12 rounded-[14px] py-6 transition-all cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
            <Plus size={22} className="text-[#D4AF37]" />
          </div>
          <span className="font-semibold text-[#E5E7EB] text-[14px]">Create Routine</span>
        </button>
        <Link
          to="/exercises"
          className="flex flex-col items-center justify-center gap-3 bg-[#0F172A] hover:bg-[#111827] border border-white/6 hover:border-white/12 rounded-[14px] py-6 transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-white/6 flex items-center justify-center">
            <BookOpen size={22} className="text-[#9CA3AF]" />
          </div>
          <span className="font-semibold text-[#E5E7EB] text-[14px]">Exercises</span>
        </Link>
      </div>

      {/* Create Routine form */}
      {isCreating && (
        <div className="bg-[#0F172A] border border-[#D4AF37]/25 rounded-[14px] p-4 mb-6 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-[#E5E7EB] text-[15px]">Name your routine</p>
            <button onClick={() => setIsCreating(false)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors cursor-pointer">
              <X size={17} />
            </button>
          </div>
          <form onSubmit={handleCreateRoutine} className="flex gap-2">
            <input
              type="text"
              value={newRoutineName}
              onChange={e => setNewRoutineName(e.target.value)}
              placeholder="e.g. Upper Body Power"
              autoFocus
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-[#E5E7EB] text-[14px] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/50 transition-colors"
            />
            <button type="submit" className="btn-primary px-5 py-2.5 text-[14px]">Save</button>
          </form>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-white/8 mb-5">
        {[
          { key: 'my-routines',  label: 'My Routines' },
          { key: 'gym-programs', label: 'Gym Programs' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab.key
                ? 'text-[#D4AF37] border-[#D4AF37]'
                : 'text-[#6B7280] border-transparent hover:text-[#9CA3AF]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Routines */}
      {activeTab === 'my-routines' && (
        <div className="flex flex-col gap-2 animate-fade-in">
          {routines.map(workout => (
            <div
              key={workout.id}
              className="bg-[#0F172A] rounded-[14px] border border-white/6 flex items-center gap-4 px-4 py-3.5 hover:border-white/12 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/8 flex items-center justify-center flex-shrink-0">
                <Dumbbell size={17} className="text-[#D4AF37]" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#E5E7EB] text-[15px] truncate">{workout.name}</p>
                <div className="flex items-center gap-3 mt-0.5 text-[12px] text-[#6B7280]">
                  <span className="flex items-center gap-1"><Dumbbell size={11} /> {workout.exercises} ex</span>
                  <span className="flex items-center gap-1"><Clock size={11} /> {workout.lastPerformed}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to={`/workouts/${workout.id}/edit`}
                  className="w-8 h-8 rounded-lg bg-white/4 hover:bg-white/8 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors border border-white/6 cursor-pointer"
                  aria-label="Edit routine"
                >
                  <Pencil size={13} />
                </Link>
                <Link
                  to={`/session/${workout.id}`}
                  className="flex items-center gap-1.5 bg-[#D4AF37] hover:bg-[#E6C766] text-black text-[12px] font-bold px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  <Play size={13} fill="currentColor" /> Start
                </Link>
              </div>
            </div>
          ))}

          {routines.length === 0 && (
            <div className="text-center py-16 text-[#6B7280]">
              <Dumbbell size={38} className="mx-auto mb-3 opacity-20" />
              <p className="text-[15px]">No routines yet</p>
              <p className="text-[13px] mt-1">Create your first routine above</p>
            </div>
          )}
        </div>
      )}

      {/* Gym Programs */}
      {activeTab === 'gym-programs' && (
        <div className="flex flex-col gap-3 animate-fade-in">
          {mockGymPrograms.map(prog => (
            <div key={prog.id} className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors overflow-hidden">
              {/* Top accent bar */}
              <div className="h-[3px] w-full" style={{ background: prog.accent }} />

              <div className="p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">{prog.level}</span>
                  <h3 className="text-[17px] font-bold text-[#E5E7EB] mt-0.5 leading-tight">{prog.name}</h3>
                  <p className="text-[12px] text-[#9CA3AF] mt-0.5">{prog.subtitle}</p>

                  <div className="flex items-center gap-4 mt-3 text-[12px] text-[#6B7280]">
                    <span>{prog.instructor}</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {prog.duration}</span>
                    <span className="flex items-center gap-1"><Users size={11} /> {prog.enrolled}</span>
                  </div>
                </div>

                <button className="flex items-center gap-1 btn-secondary text-[12px] font-semibold px-3.5 py-2 flex-shrink-0">
                  View <ChevronRight size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};

export default Workouts;
