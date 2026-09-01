export const USER_GOAL_UPDATED_EVENT = 'user-goal-updated';

export interface UserGoalUpdatedPayload {
  sleep: number;
  sleepHour: number;
  step: number;
  calorie: number;
  motionTime: number;
  acquisitionCycle: number;
}
