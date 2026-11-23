import { CoreScreenStory } from './fixtures';

export const screenStory = (path: string, populated: boolean, hasRunningQueue = false) => ({
  render: () => (
    <CoreScreenStory path={path} populated={populated} hasRunningQueue={hasRunningQueue} />
  )
});
