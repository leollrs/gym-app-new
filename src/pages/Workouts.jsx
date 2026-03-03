import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Play, Plus, Dumbbell, Clock, ChevronRight, Pencil, BookOpen, Users, X, Trash2
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';

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

const formatLastPerformed = (isoDate) => {
  if (!isoDate) return 'Never';
  const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} weeks ago`;
  return `${Math.floor(diff / 30)} months ago`;
};

const Workouts = () => {
  const navigate = useNavigate();
  const { routines, loading, createRoutine, deleteRoutine } = useRoutines();
  const [activeTab, setActiveTab]       = useState('my-routines');
  const [isCreating, setIsCreating]     = useState(false);
  const [newRoutineName, setNewRoutineName] = useState('');
  const [creating, setCreating]         = useState(false);
  const [deletingId, setDeletingId]     = useState(null);

  const handleCreateRoutine = async (e) => {
    e.preventDefault();
    if (!newRoutineName.trim()) return;
    setCreating(true);
    try {
      const routine = await createRoutine(newRoutineName.trim());
      setNewRoutineName('');
      setIsCreating(false);
      navigate(`/workouts/${routine.id}/edit`);
    } catch (err) {
      console.error('Failed to create routine:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteRoutine(id);
    } catch (err) {
      console.error('Failed to delete routine:', err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* Page header */}
      <header className="mb-10">
        <h1 className="text-[24px] font-bold text-[#E5E7EB]">Workouts</h1>
        <p className="text-[13px] text-[#6B7280] mt-1">Your routines and gym programs.</p>
      </header>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <button
          onClick={() => setIsCreating(true)}
          className="flex flex-col items-center justify-center gap-3 bg-[#0F172A] hover:bg-[#111827] border border-white/6 hover:border-white/12 rounded-[14px] py-8 transition-all cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
            <Plus size={22} className="text-[#D4AF37]" />
          </div>
          <span className="font-semibold text-[#E5E7EB] text-[14px]">Create Routine</span>
        </button>
        <Link
          to="/exercises"
          className="flex flex-col items-center justify-center gap-3 bg-[#0F172A] hover:bg-[#111827] border border-white/6 hover:border-white/12 rounded-[14px] py-8 transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-white/6 flex items-center justify-center">
            <BookOpen size={22} className="text-[#9CA3AF]" />
          </div>
          <span className="font-semibold text-[#E5E7EB] text-[14px]">Browse Exercises</span>
        </Link>
      </div>

      {/* Create Routine form */}
      {isCreating && (
        <div className="bg-[#0F172A] border border-[#D4AF37]/25 rounded-[14px] p-5 mb-8 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-[#E5E7EB] text-[15px]">Name your routine</p>
            <button onClick={() => setIsCreating(false)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors cursor-pointer">
              <X size={17} />
            </button>
          </div>
          <form onSubmit={handleCreateRoutine} className="flex gap-3">
            <input
              type="text"
              value={newRoutineName}
              onChange={e => setNewRoutineName(e.target.value)}
              placeholder="e.g. Upper Body Power"
              autoFocus
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-[#E5E7EB] text-[14px] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/50 transition-colors"
            />
            <button
              type="submit"
              disabled={creating}
              className="btn-primary px-5 py-3 text-[14px] disabled:opacity-50"
            >
              {creating ? '…' : 'Create'}
            </button>
          </form>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-white/8 mb-8">
        {[
          { key: 'my-routines',  label: 'My Routines' },
          { key: 'gym-programs', label: 'Gym Programs' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3.5 text-[13px] font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
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
        <div className="flex flex-col gap-3 animate-fade-in">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[76px] animate-pulse" />
              ))}
            </div>
          ) : routines.length === 0 ? (
            <div className="text-center py-20 text-[#6B7280]">
              <Dumbbell size={40} className="mx-auto mb-4 opacity-20" />
              <p className="text-[15px]">No routines yet</p>
              <p className="text-[13px] mt-1">Create your first routine above</p>
            </div>
          ) : (
            routines.map(routine => (
              <div
                key={routine.id}
                className="bg-[#0F172A] rounded-[14px] border border-white/6 flex items-center gap-3 px-4 py-3.5 hover:border-white/12 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/8 flex items-center justify-center flex-shrink-0">
                  <Dumbbell size={16} className="text-[#D4AF37]" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#E5E7EB] text-[15px] truncate">{routine.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[12px] text-[#6B7280]">
                    <span className="flex items-center gap-1">
                      <Dumbbell size={10} /> {routine.exerciseCount} ex
                    </span>
                    <span className="flex items-center gap-1 truncate">
                      <Clock size={10} className="flex-shrink-0" /> {formatLastPerformed(routine.lastPerformedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={(e) => handleDelete(e, routine.id)}
                    disabled={deletingId === routine.id}
                    className="w-9 h-9 rounded-lg bg-white/4 hover:bg-red-500/10 flex items-center justify-center text-[#6B7280] hover:text-red-400 transition-colors border border-white/6 cursor-pointer disabled:opacity-40"
                    aria-label="Delete routine"
                  >
                    <Trash2 size={14} />
                  </button>
                  <Link
                    to={`/workouts/${routine.id}/edit`}
                    className="w-9 h-9 rounded-lg bg-white/4 hover:bg-white/8 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors border border-white/6 cursor-pointer"
                    aria-label="Edit routine"
                  >
                    <Pencil size={14} />
                  </Link>
                  <Link
                    to={`/session/${routine.id}`}
                    className="w-9 h-9 rounded-xl bg-[#D4AF37] hover:bg-[#E6C766] flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer active:scale-95"
                    style={{ boxShadow: '0 0 10px rgba(212,175,55,0.3)' }}
                    aria-label="Start routine"
                  >
                    <Play size={14} fill="white" stroke="white" strokeWidth={1.5} />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Gym Programs */}
      {activeTab === 'gym-programs' && (
        <div className="flex flex-col gap-4 animate-fade-in">
          {mockGymPrograms.map(prog => (
            <div key={prog.id} className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors overflow-hidden">
              <div className="h-[3px] w-full" style={{ background: prog.accent }} />
              <div className="p-5 flex items-start gap-5">
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-widest">{prog.level}</span>
                  <h3 className="text-[18px] font-bold text-[#E5E7EB] mt-1 leading-tight">{prog.name}</h3>
                  <p className="text-[13px] text-[#9CA3AF] mt-0.5">{prog.subtitle}</p>
                  <div className="flex items-center gap-5 mt-4 text-[12px] text-[#6B7280]">
                    <span>{prog.instructor}</span>
                    <span className="flex items-center gap-1.5"><Clock size={12} /> {prog.duration}</span>
                    <span className="flex items-center gap-1.5"><Users size={12} /> {prog.enrolled}</span>
                  </div>
                </div>
                <button className="flex items-center gap-1 btn-secondary text-[13px] font-semibold px-4 py-2.5 flex-shrink-0">
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
