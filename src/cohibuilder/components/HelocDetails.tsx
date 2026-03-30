import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, CreditCard, ShieldAlert, Info, DollarSign, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { findLoanForNavId } from '../lib/resolveLoanNav';
import { anonymizeBorrowerName } from '../lib/borrowerPrivacy';

interface HelocDetailsProps {
  loanId: number | null;
  onBack: () => void;
}

export default function HelocDetails({ loanId, onBack }: HelocDetailsProps) {
  const { allLoans: loans } = useCohiBuilderPortfolio();
  const loan = useMemo(() => findLoanForNavId(loans, loanId), [loans, loanId]);
  const heloc = loan?.helocData;

  if (!loan) {
    return (
      <div className="card-base rounded-2xl p-8 sm:p-10 text-center space-y-4 max-w-lg mx-auto">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">Loan not in portfolio</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {loanId != null ? (
            <>
              No loan matches id <span className="tabular-nums font-medium">{loanId}</span> (internal id or LOS loan number).
            </>
          ) : (
            'Open a loan from the list first.'
          )}
        </p>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl btn-primary text-sm font-semibold">
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    );
  }

  if (!heloc) {
    return (
      <div className="card-base rounded-2xl p-8 sm:p-10 text-center space-y-4 max-w-lg mx-auto">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">No HELOC on this file</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">This loan has no HELOC demo data.</p>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl btn-primary text-sm font-semibold">
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl text-[var(--text-primary)] font-bold tracking-tight">HELOC Monitor</h1>
          <p className="text-[var(--text-secondary)] mt-1 font-medium">Detailed line of credit monitoring for {anonymizeBorrowerName(loan.borrower)}.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 relative">
              <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest mb-1">Total Line</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(heloc.totalLine)}
              </p>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 relative">
              <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest mb-1">Current Balance</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(heloc.currentBalance)}
              </p>
            </div>
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 relative">
              <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest mb-1">Utilization</p>
              <p className={`text-2xl font-bold tracking-tight ${heloc.utilization > 80 ? 'text-rose-600' : 'text-teal-600'}`}>
                {heloc.utilization}%
              </p>
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 relative">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6">Recent Draw History</h2>
            <div className="space-y-4">
              {[
                { date: 'Mar 12, 2026', amount: 15000, purpose: 'Construction Draw #4', status: 'Completed' },
                { date: 'Feb 28, 2026', amount: 8500, purpose: 'Material Purchase', status: 'Completed' },
                { date: 'Feb 10, 2026', amount: 22000, purpose: 'Construction Draw #3', status: 'Completed' },
              ].map((draw, index) => (
                <div key={index} className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-teal-500/10 text-teal-600 flex items-center justify-center">
                      <DollarSign size={18} />
                    </div>
                    <div>
                      <h4 className="font-bold text-[var(--text-primary)]">{draw.purpose}</h4>
                      <p className="text-xs text-[var(--text-secondary)]">{draw.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[var(--text-primary)]">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(draw.amount)}
                    </p>
                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{draw.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 relative">
            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <ShieldAlert size={18} className="text-teal-600" />
              Line Status
            </h3>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-[var(--border-subtle)]">
                <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest mb-1">Current Status</p>
                <p className={`text-xl font-bold ${heloc.status === 'Frozen' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {heloc.status}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-[var(--border-subtle)]">
                <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest mb-1">Interest Rate</p>
                <p className="text-xl font-bold text-[var(--text-primary)]">7.25% (Prime + 1.00%)</p>
              </div>
            </div>
          </div>

          <div className="bg-teal-600 text-white rounded-2xl shadow-sm border border-teal-700 p-6 relative">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Clock size={18} />
              Next Review
            </h3>
            <p className="text-3xl font-extrabold tracking-tight mb-2">Apr 15, 2026</p>
            <p className="text-sm text-teal-100 opacity-80 leading-relaxed">
              Automatic line review scheduled for construction-to-perm conversion window.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
