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
    color: 'from-blue-600/40 to-violet-600/20',
  },
  {
    id: 'gp2',
    name: 'Summer Shred',
    subtitle: 'Fat loss + strength',
    instructor: 'Coach Mike',
    duration: '6 weeks',
    level: 'All Levels',
    enrolled: 89,
    color: 'from-amber-600/40 to-orange-600/20',
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
        <h1 className="text-[24px] font-bold text-white">Workouts</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">Your routines and gym programs.</p>
      </header>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-3 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/25 hover:border-blue-500/50 rounded-2xl p-4 transition-all cursor-pointer text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Plus size={20} className="text-white" />
          </div>
          <span className="font-semibold text-white text-[15px]">New Routine</span>
        </button>
        <Link
          to="/exercises"
          className="flex items-center gap-3 bg-white/5 hover:bg-white/8 border border-white/6 rounded-2xl p-4 transition-all cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center flex-shrink-0">
            <BookOpen size={20} className="text-slate-300" />
          </div>
          <span className="font-semibold text-white text-[15px]">Exercises</span>
        </Link>
      </div>

      {/* Create Routine form */}
      {isCreating && (
        <div className="bg-[#161e35] border border-blue-500/30 rounded-2xl p-4 mb-6 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-white text-[15px]">Name your routine</p>
            <button onClick={() => setIsCreating(false)} className="text-slate-500 hover:text-white transition-colors cursor-pointer">
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleCreateRoutine} className="flex gap-2">
            <input
              type="text"
              value={newRoutineName}
              onChange={e => setNewRoutineName(e.target.value)}
              placeholder="e.g. Upper Body Power"
              autoFocus
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-[14px] placeholder-slate-600 focus:outline-none focus:border-blue-500/60 transition-colors"
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
            className={`flex-1 py-3 text-[14px] font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab.key
                ? 'text-white border-blue-500'
                : 'text-slate-500 border-transparent hover:text-slate-300'
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
              className="bg-[#131929] backdrop-blur-md rounded-2xl border border-white/5 flex items-center gap-4 px-4 py-3.5 hover:border-white/10 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Dumbbell size={18} className="text-blue-400" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-[15px] truncate">{workout.name}</p>
                <div className="flex items-center gap-3 mt-0.5 text-[12px] text-slate-500">
                  <span className="flex items-center gap-1"><Dumbbell size={11} /> {workout.exercises} ex</span>
                  <span className="flex items-center gap-1"><Clock size={11} /> {workout.lastPerformed}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to={`/workouts/${workout.id}/edit`}
                  className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors border border-white/6 cursor-pointer"
                  aria-label="Edit routine"
                >
                  <Pencil size={15} />
                </Link>
                <Link
                  to={`/session/${workout.id}`}
                  className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-400 text-white text-[13px] font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  <Play size={14} fill="currentColor" /> Start
                </Link>
              </div>
            </div>
          ))}

          {routines.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <Dumbbell size={40} className="mx-auto mb-3 opacity-20" />
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
            <div key={prog.id} className="bg-[#131929] backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden">
              {/* Card top gradient band */}
              <div className={`h-2 w-full bg-gradient-to-r ${prog.color}`} />

              <div className="p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{prog.level}</span>
                  <h3 className="text-[17px] font-bold text-white mt-0.5 leading-tight">{prog.name}</h3>
                  <p className="text-[12px] text-slate-400 mt-0.5">{prog.subtitle}</p>

                  <div className="flex items-center gap-4 mt-3 text-[12px] text-slate-500">
                    <span>By {prog.instructor}</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {prog.duration}</span>
                    <span className="flex items-center gap-1"><Users size={11} /> {prog.enrolled}</span>
                  </div>
                </div>

                <button className="flex items-center gap-1.5 bg-white/6 hover:bg-white/10 border border-white/8 text-white text-[13px] font-semibold px-3.5 py-2 rounded-xl transition-colors flex-shrink-0 cursor-pointer">
                  View <ChevronRight size={14} />
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
