import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useShopMembers, type UserShop } from '@/hooks/useShopMembers'
import { useShopeeAuth } from '@/hooks/useShopeeAuth'
import { 
  Store, 
  Crown, 
  User, 
  Users, 
  Settings,
  ExternalLink
} from 'lucide-react'

interface ShopListProps {
  onShopSelect?: (shopId: number) => void
  onManageMembers?: (shop: UserShop) => void
  showMemberManagement?: boolean
}

export const ShopList: React.FC<ShopListProps> = ({ 
  onShopSelect, 
  onManageMembers,
  showMemberManagement = false 
}) => {
  const { userShops, loading } = useShopMembers()
  const { selectedShopId, switchShop } = useShopeeAuth()

  const handleShopClick = async (shop: UserShop) => {
    if (selectedShopId !== shop.shop_id) {
      await switchShop(shop.shop_id)
    }
    onShopSelect?.(shop.shop_id)
  }

  const getRoleIcon = (role: string) => {
    return role === 'admin' ? (
      <Crown className="h-4 w-4 text-yellow-500" />
    ) : (
      <User className="h-4 w-4 text-blue-500" />
    )
  }

  const getRoleBadge = (role: string) => {
    return (
      <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
        {role === 'admin' ? 'Admin' : 'Member'}
      </Badge>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className="rounded-full bg-muted h-12 w-12"></div>
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (userShops.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <CardTitle className="mb-2">Chưa có shop nào</CardTitle>
          <CardDescription>
            Bạn chưa kết nối shop nào hoặc chưa được mời vào shop nào.
            Hãy kết nối shop của bạn để bắt đầu.
          </CardDescription>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {userShops.map((shop) => (
        <Card 
          key={shop.shop_id} 
          className={`cursor-pointer transition-all hover:shadow-md ${
            selectedShopId === shop.shop_id ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => handleShopClick(shop)}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={`https://via.placeholder.com/40?text=${shop.shop_name?.charAt(0) || 'S'}`} />
                  <AvatarFallback>
                    <Store className="h-5 w-5" />
                  </AvatarFallback>
                </Avatar>
                
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{shop.shop_name || `Shop ${shop.shop_id}`}</CardTitle>
                    {selectedShopId === shop.shop_id && (
                      <Badge variant="outline" className="text-xs">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Đang chọn
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <span>ID: {shop.shop_id}</span>
                    {shop.region && (
                      <>
                        <span>•</span>
                        <span>{shop.region.toUpperCase()}</span>
                      </>
                    )}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {getRoleIcon(shop.role)}
                {getRoleBadge(shop.role)}
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  <span>{shop.member_count} thành viên</span>
                </div>
                
                {shop.is_admin && (
                  <div className="flex items-center gap-1 text-yellow-600">
                    <Crown className="h-4 w-4" />
                    <span>Bạn là Admin</span>
                  </div>
                )}
              </div>

              {showMemberManagement && shop.is_admin && onManageMembers && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onManageMembers(shop)
                  }}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Quản lý
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}