import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { trackError } from '../lib/errorTracker';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
    trackError('react_crash', error, { componentStack: errorInfo.componentStack });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-6">
          <div className="bg-[#0F172A] border border-white/8 rounded-2xl p-8 max-w-md w-full text-center space-y-5">
            <div className="mx-auto w-14 h-14 rounded-full bg-[#D4AF37]/10 flex items-center justify-center">
              <AlertTriangle size={28} className="text-[#D4AF37]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-[18px] font-bold text-[#E5E7EB]">Something went wrong</h2>
              <p className="text-[13px] text-[#6B7280] leading-relaxed">
                An unexpected error occurred. Please try again or refresh the page.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="bg-[#111827] border border-white/6 rounded-xl px-4 py-3">
                <p className="text-[12px] text-[#9CA3AF] font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] transition-colors"
            >
              <RotateCcw size={16} />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
