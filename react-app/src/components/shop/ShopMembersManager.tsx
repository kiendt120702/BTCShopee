import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useShopMembers, type ShopMember } from '@/hooks/useShopMembers'
import { useAuth } from '@/hooks/useAuth'
import { 
  UserPlus, 
  Crown, 
  User, 
  MoreVertical, 
  Trash2, 
  Shield,
  Mail,
  Calendar
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ShopMembersManagerProps {
  shopId: number
  shopName: string
}

export const ShopMembersManager: React.FC<ShopMembersManagerProps> = ({ 
  shopId, 
  shopName 
}) => {
  const { user } = useAuth()
  const {
    members,
    currentUserRole,
    loading,
    inviteMember,
    removeMember,
    updateMemberRole,
    fetchShopMembers
  } = useShopMembers(shopId)

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteLoading, setInviteLoading] = useState(false)

  const isAdmin = currentUserRole === 'admin'

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) return

    setInviteLoading(true)
    const success = await inviteMember(shopId, inviteEmail, inviteRole)
    
    if (success) {
      setInviteEmail('')
      setInviteRole('member')
      setInviteDialogOpen(false)
    }
    setInviteLoading(false)
  }

  const handleRemoveMember = async (member: ShopMember) => {
    const success = await removeMember(shopId, member.user_id)
    if (success) {
      await fetchShopMembers(shopId)
    }
  }

  const handleUpdateRole = async (member: ShopMember, newRole: 'admin' | 'member') => {
    const success = await updateMemberRole(shopId, member.user_id, newRole)
    if (success) {
      await fetchShopMembers(shopId)
    }
  }

  const getRoleIcon = (role: string) => {
    return role === 'admin' ? <Crown className="h-4 w-4 text-yellow-500" /> : <User className="h-4 w-4 text-blue-500" />
  }

  const getRoleBadge = (role: string) => {
    return (
      <Badge variant={role === 'admin' ? 'default' : 'secondary'} className="ml-2">
        {role === 'admin' ? 'Admin' : 'Member'}
      </Badge>
    )
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Quản lý thành viên
            </CardTitle>
            <CardDescription>
              Quản lý quyền truy cập shop "{shopName}"
            </CardDescription>
          </div>
          
          {isAdmin && (
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Mời thành viên
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Mời thành viên mới</DialogTitle>
                  <DialogDescription>
                    Nhập email của người bạn muốn mời vào shop này
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="role">Quyền</Label>
                    <Select value={inviteRole} onValueChange={(value: 'member' | 'admin') => setInviteRole(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            Member - Chỉ xem dữ liệu
                          </div>
                        </SelectItem>
                        <SelectItem value="admin">
                          <div className="flex items-center gap-2">
                            <Crown className="h-4 w-4" />
                            Admin - Toàn quyền
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button 
                    variant="outline" 
                    onClick={() => setInviteDialogOpen(false)}
                    disabled={inviteLoading}
                  >
                    Hủy
                  </Button>
                  <Button 
                    onClick={handleInviteMember}
                    disabled={inviteLoading || !inviteEmail.trim()}
                  >
                    {inviteLoading ? 'Đang mời...' : 'Gửi lời mời'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-sm text-muted-foreground">Đang tải...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {members.length === 0 ? (
              <div className="text-center py-8">
                <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Chưa có thành viên nào</p>
              </div>
            ) : (
              members.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={member.avatar_url || undefined} />
                      <AvatarFallback>
                        {member.full_name?.charAt(0) || member.email.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {getRoleIcon(member.role)}
                        <span className="font-medium">
                          {member.full_name || member.email}
                        </span>
                        {getRoleBadge(member.role)}
                        {member.user_id === user?.id && (
                          <Badge variant="outline" className="text-xs">Bạn</Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {member.email}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Tham gia {formatDate(member.created_at)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {isAdmin && member.user_id !== user?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleUpdateRole(
                            member, 
                            member.role === 'admin' ? 'member' : 'admin'
                          )}
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          {member.role === 'admin' ? 'Hạ xuống Member' : 'Thăng lên Admin'}
                        </DropdownMenuItem>
                        
                        <Separator />
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive"
                              onSelect={(e) => e.preventDefault()}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Xóa khỏi shop
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Xác nhận xóa thành viên</AlertDialogTitle>
                              <AlertDialogDescription>
                                Bạn có chắc muốn xóa <strong>{member.full_name || member.email}</strong> khỏi shop này?
                                Họ sẽ mất quyền truy cập vào tất cả dữ liệu của shop.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Hủy</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveMember(member)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Xóa thành viên
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}