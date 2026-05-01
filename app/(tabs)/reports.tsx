import { StubScreen } from '@/components/shell/StubScreen';

export default function ReportsScreen() {
  return (
    <StubScreen
      icon="bar-chart-outline"
      title="Reports"
      description="Pipeline, win-rate, storm-correlated revenue, and crew utilization. Export to PDF for ownership reviews."
      bullets={[
        'Monthly revenue + delta vs last 12 months',
        'Lead source attribution (storm, referral, paid)',
        'Forensic accuracy: AI labels approved vs. rejected',
        'Crew utilization heatmap',
      ]}
    />
  );
}
