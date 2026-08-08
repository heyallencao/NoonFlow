import { DevMoodCompanionDemo } from '@/components/dashboard/DevMoodCompanion';

export default function DevMoodDemoPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Dev Mood Companion</h1>
        <p className="text-muted-foreground mb-8">
          A demo of the stick figure mascot for the dashboard
        </p>
        <DevMoodCompanionDemo />
      </div>
    </div>
  );
}
