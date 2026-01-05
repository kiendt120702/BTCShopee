/**
 * User Profile Panel
 * Hiển thị thông tin người dùng
 */

import { UserProfileInfo } from '@/components/profile/UserProfileInfo';

export function UserProfilePanel() {
  return (
    <div className="max-w-6xl mx-auto">
      <UserProfileInfo />
    </div>
  );
}

export default UserProfilePanel;
