/* eslint-disable @typescript-eslint/no-explicit-any */
import imageLogo from '../../assets/logo/CONSTIL.svg';
import { useEffect, useState } from 'react';
import { Avatar, Typography, Box, IconButton, Menu, MenuItem } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { NavLink } from 'react-router-dom';
import UpgradeProfile from '../../components/subscription/upgrade-profile';
import { FiMenu } from 'react-icons/fi';
import { useDispatch, useSelector } from 'react-redux';
import { clearAuth } from '../../redux/authSlice';
import { useGetUserProfileQuery } from '../../services/rtkapi/invoiceApi';
import { S3UploadService } from '../../components/data/s3-data';
// import { Badge } from '@mui/material';
// import NotificationsIcon from '@mui/icons-material/Notifications';
// import { createClient } from '@supabase/supabase-js';
// import { useNavigate } from 'react-router-dom';

// const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
// const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
// const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface navbarProps {
  onMenuClick?: () => void;
  isWelcomePage: boolean;
}

export function Navbar({ onMenuClick, isWelcomePage }: navbarProps) {
  const { data, refetch } = useGetUserProfileQuery();
  const user = useSelector((state: { auth: { user: any } }) => state.auth.user);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  // const [pendingCount, setPendingCount] = useState(0);
  // const navigate = useNavigate();

  /* useEffect(() => {
    // Initial fetch of pending emails
    const fetchPendingCount = async () => {
      const { count } = await supabase
        .from('review_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      // setPendingCount(count || 0);
    };

    fetchPendingCount();

    // Subscribe to new emails in realtime
    const subscription = supabase
      .channel('public:review_queue')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'review_queue' },
        (payload) => {
          if (payload.new && payload.new.status === 'pending') {
            // setPendingCount((prev) => prev + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'review_queue' },
        (payload) => {
          if (payload.new && payload.new.status !== 'pending' && payload.old.status === 'pending') {
            // setPendingCount((prev) => Math.max(0, prev - 1));
          } else if (payload.new && payload.new.status === 'pending' && payload.old.status !== 'pending') {
            // setPendingCount((prev) => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []); */

  useEffect(() => {
    if (user?.name) {
      localStorage.setItem('username', user.name);
    } else {
      localStorage.removeItem('username');
    }
    if (data?.data) {
      refetch();
    }
  }, [user, data, refetch]);

  const open = Boolean(anchorEl);
  const dispatch = useDispatch();

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    dispatch(clearAuth());
    window.location.href = 'https://constil.com';
  };

  return (
    <header className="bg-white shadow-md fixed top-0 left-0 right-0 z-50 overflow-hidden">
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        p={2}
        bgcolor="white"
        sx={{ overflow: 'hidden', minWidth: 0 }}
      >
        <div className="flex items-center">
          <button
            hidden={isWelcomePage}
            type="button"
            className="xl:hidden mr-4 text-gray-700"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <FiMenu size={24} />
          </button>
          <Box>
            <img src={imageLogo} alt="Logo" className="h-5 w-40" />
          </Box>
        </div>

        <Box display="flex" alignItems="center" gap={1} bgcolor="white" sx={{ overflow: 'hidden', minWidth: 0, flexShrink: 1 }}>
          <Typography
            hidden={isWelcomePage}
            variant="body2"
            className="hidden sm:inline-block"
            sx={{ whiteSpace: 'nowrap', fontSize: '0.875rem', ml: 3 }}
          />

          <Typography
            hidden={isWelcomePage}
            variant="body2"
            className="hidden sm:inline-block"
            sx={{ whiteSpace: 'nowrap', fontSize: '0.875rem', ml: 3 }}
          >
            <UpgradeProfile />
          </Typography>

          {/* <IconButton 
            onClick={() => navigate('/review-queue')} 
            sx={{ ml: 2, mr: 1, color: 'gray' }}
            title="Review Queue"
          >
            <Badge badgeContent={pendingCount} color="error" overlap="circular">
              <NotificationsIcon />
            </Badge>
          </IconButton> */}

          {data?.data?.register?.name || user ? (
            <>
              <Typography
                className="hidden sm:block"
                variant="body1"
                sx={{
                  mr: 1,
                  color: 'var(--color-ink)',
                  textOverflow: 'ellipsis',
                  maxWidth: '120px',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                @
                {`${
                  user?.first_name && user?.last_name
                    ? `${user.first_name} ${user.last_name}`
                    : user?.first_name ||
                      data?.data?.register?.name ||
                      user?.name ||
                      user?.last_name ||
                      user?.email ||
                      'User'
                }`}
              </Typography>

              <Box
                onClick={(e) => {
                  if (window.innerWidth < 1024) {
                    handleClick(e);
                  }
                }}
                className="cursor-pointer lg:cursor-default hover:opacity-80 lg:hover:opacity-100"
              >
                <Avatar
                  src={
                    data?.data?.avatar_url
                      ? S3UploadService.getPublicUrl(data.data.avatar_url, 'document-logos')
                      : user?.user_metadata?.avatar_url || user?.image || ''
                  }
                  alt="User Avatar"
                  sx={{ width: 40, height: 40 }}
                />
              </Box>

              <IconButton onClick={handleClick} size="small" className="hidden lg:inline-flex">
                <ExpandMoreIcon fontSize="small" />
              </IconButton>
            </>
          ) : (
            <Typography variant="body1" color="error">
              User Unauthenticated
            </Typography>
          )}

          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={handleClose}
            PaperProps={{
              sx: { mt: 1, minWidth: '120px' },
            }}
          >
            <MenuItem onClick={handleClose}>
              <NavLink to="/user/myprofile">My Profile</NavLink>
            </MenuItem>
            <MenuItem onClick={handleLogout}>Sign out</MenuItem>
          </Menu>
        </Box>
      </Box>
    </header>
  );
}
