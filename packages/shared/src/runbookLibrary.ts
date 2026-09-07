import type { Runbook, RunbookStep } from './runbooks'

/**
 * Sổ tay vận hành CÓ SẴN — nội dung tiếng Việt (bản đầu). Mỗi sổ tay là các bước + lệnh + chỗ
 * cần cẩn thận, viết cho người đang SSH vào máy production: luôn nói rõ lệnh nào có hiệu lực
 * ngay, lệnh nào chỉ ghi file, và lệnh nào có thể tự khoá mình ra ngoài.
 *
 * Biến `{{ip}}`, `{{port}}`, `{{domain}}`, `{{user}}`… được điền ở UI trước khi chép. Ví dụ trong
 * ghi chú chỉ dùng địa chỉ/tên tài liệu (203.0.113.10, example.com).
 */

const s = (title: string, command?: string, note?: string, danger = false): RunbookStep => ({
  title,
  ...(command ? { command } : {}),
  ...(note ? { note } : {}),
  ...(danger ? { danger: true } : {})
})

const SSH_LOCKOUT = 'Luôn giữ MỘT phiên SSH khác đang mở trong lúc làm. Nếu rule sai, phiên đó là đường cứu duy nhất.'

export const RUNBOOK_LIBRARY: readonly Runbook[] = [
  {
    id: 'fw-whitelist-ip',
    title: 'Whitelist một IP qua firewall',
    category: 'firewall',
    tags: ['iptables', 'firewalld', 'ufw', 'nftables', 'whitelist', 'allow'],
    summary: 'Cho phép một IP đi qua firewall của server, theo đúng hệ firewall máy đang dùng. Kiểm hệ nào trước: `systemctl is-active firewalld ufw iptables`.',
    warnings: [
      SSH_LOCKOUT,
      'Với iptables-services: thêm rule SỐNG bằng `iptables -I` trước (có hiệu lực ngay, chưa lưu), thấy vẫn còn kết nối rồi mới lưu ra file. Sửa tay /etc/sysconfig/iptables rồi restart là cách dễ mất kết nối nhất.'
    ],
    variants: [
      {
        id: 'iptables',
        label: 'iptables-services (RHEL/CentOS/Alma/Rocky)',
        steps: [
          s('Xem rule hiện tại của chain INPUT', 'iptables -L INPUT -n --line-numbers', 'Nhớ vị trí rule DROP/REJECT cuối chain — rule mới phải đứng TRƯỚC nó.'),
          s('Thêm rule sống, chèn lên đầu chain', 'iptables -I INPUT -s {{ip}} -j ACCEPT', '`-I` = insert đầu chain, hiệu lực ngay, CHƯA lưu. Chỉ mở một cổng: thêm `-p tcp --dport {{port}}`.'),
          s('Kiểm lại', 'iptables -L INPUT -n --line-numbers | head -20'),
          s('Lưu ra file để sống qua reboot', 'iptables-save > /etc/sysconfig/iptables', 'Hoặc `service iptables save` nếu có. File này chính là thứ `systemctl restart iptables` sẽ nạp.'),
          s('Xác nhận file đã có rule', 'grep -n "{{ip}}" /etc/sysconfig/iptables'),
          s(
            'Chỉ khi cần: restart để nạp lại toàn bộ file',
            'systemctl restart iptables',
            'KHÔNG cần bước này nếu đã dùng `-I` ở trên (rule đã sống). Restart nạp lại từ file — file sai là mất kết nối.',
            true
          )
        ]
      },
      {
        id: 'firewalld',
        label: 'firewalld',
        steps: [
          s('Xem zone và rule hiện tại', 'firewall-cmd --get-active-zones; firewall-cmd --list-all'),
          s(
            'Thêm rich rule cho IP (permanent)',
            'firewall-cmd --permanent --zone=public --add-rich-rule=\'rule family="ipv4" source address="{{ip}}" accept\'',
            'Chỉ mở một cổng: `... source address="{{ip}}" port port="{{port}}" protocol="tcp" accept`. Đổi `public` theo zone đang active.'
          ),
          s('Nạp lại', 'firewall-cmd --reload', 'Reload của firewalld KHÔNG cắt kết nối đang có.'),
          s('Kiểm', 'firewall-cmd --list-rich-rules')
        ]
      },
      {
        id: 'ufw',
        label: 'ufw (Ubuntu/Debian)',
        steps: [
          s('Xem trạng thái', 'ufw status numbered'),
          s('Cho phép IP (mọi cổng) hoặc một cổng', 'ufw allow from {{ip}}\nufw allow from {{ip}} to any port {{port}} proto tcp', 'Rule ufw có hiệu lực ngay và tự lưu.'),
          s('Nếu ufw chưa bật: mở SSH TRƯỚC rồi mới enable', 'ufw allow 22/tcp\nufw enable', '`ufw enable` mà chưa allow SSH là tự khoá mình.', true),
          s('Kiểm', 'ufw status numbered')
        ]
      },
      {
        id: 'nft',
        label: 'nftables',
        steps: [
          s('Xem ruleset', 'nft list ruleset'),
          s('Thêm rule accept cho IP', 'nft insert rule inet filter input ip saddr {{ip}} accept', 'Tên table/chain (`inet filter input`) lấy từ `nft list ruleset` — mỗi distro đặt khác.'),
          s('Lưu để sống qua reboot', 'nft list ruleset > /etc/nftables.conf', 'Debian/Ubuntu đọc file này qua `nftables.service`.')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'fw-block-ip',
    title: 'Chặn một IP đang tấn công',
    category: 'firewall',
    tags: ['iptables', 'firewalld', 'ufw', 'fail2ban', 'block', 'drop', 'ban'],
    summary: 'Chặn nhanh một IP (bot cào, brute-force). Kiểm IP đó có phải là load balancer/proxy của mình không trước khi chặn.',
    warnings: ['Đừng chặn IP của load balancer, CDN, hay chính mình. Xem IP đang kết nối: `ss -tn | awk \'{print $5}\' | cut -d: -f1 | sort | uniq -c | sort -rn | head`.'],
    variants: [
      {
        id: 'iptables',
        label: 'iptables',
        steps: [
          s('Chặn ngay', 'iptables -I INPUT -s {{ip}} -j DROP', 'Có hiệu lực ngay, chưa lưu.'),
          s('Lưu', 'iptables-save > /etc/sysconfig/iptables', 'Debian/Ubuntu: `netfilter-persistent save` (gói iptables-persistent).'),
          s('Gỡ chặn khi cần', 'iptables -D INPUT -s {{ip}} -j DROP')
        ]
      },
      {
        id: 'firewalld',
        label: 'firewalld',
        steps: [
          s('Chặn (permanent) + reload', 'firewall-cmd --permanent --add-rich-rule=\'rule family="ipv4" source address="{{ip}}" drop\'\nfirewall-cmd --reload'),
          s('Gỡ', 'firewall-cmd --permanent --remove-rich-rule=\'rule family="ipv4" source address="{{ip}}" drop\'\nfirewall-cmd --reload')
        ]
      },
      {
        id: 'ufw',
        label: 'ufw',
        steps: [
          s('Chặn — chèn lên VỊ TRÍ 1 để đứng trước rule allow', 'ufw insert 1 deny from {{ip}}', '`ufw deny from` (không insert) sẽ nằm cuối và bị rule allow phía trên vô hiệu.'),
          s('Gỡ', 'ufw delete deny from {{ip}}')
        ]
      },
      {
        id: 'fail2ban',
        label: 'fail2ban',
        steps: [
          s('Xem jail và IP đang bị ban', 'fail2ban-client status\nfail2ban-client status sshd'),
          s('Ban tay một IP', 'fail2ban-client set sshd banip {{ip}}'),
          s('Gỡ ban', 'fail2ban-client set sshd unbanip {{ip}}')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'cron-add-job',
    title: 'Thêm một cron job',
    category: 'cron',
    tags: ['crontab', 'cron.d', 'schedule', 'lịch'],
    summary: 'Thêm lệnh chạy theo lịch cho user hiện tại hoặc toàn hệ. Trong app cũng có công cụ ⏰ Lịch chạy (cron) để xem và sửa có xác nhận.',
    warnings: ['Cron chạy với PATH rất ngắn và KHÔNG nạp .bashrc: dùng đường dẫn tuyệt đối cho lệnh (`/usr/bin/php`) và cho file. Giờ theo múi giờ của server (`timedatectl`).'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Mở crontab của user hiện tại', 'crontab -e', 'Sửa cho user khác: `crontab -u {{user}} -e`.'),
          s(
            'Thêm dòng theo mẫu: phút giờ ngày tháng thứ  lệnh',
            '# Mỗi ngày 03:15, ghi log ra file\n15 3 * * * /usr/bin/php /var/www/app/artisan backup:run >> /var/log/app-backup.log 2>&1\n# Mỗi 5 phút\n*/5 * * * * /usr/local/bin/check.sh',
            'Luôn chuyển hướng output (`>> file 2>&1`) — không thì cron gửi mail hoặc mất dấu.'
          ),
          s('Xem lại', 'crontab -l'),
          s(
            'Cách khác: file trong /etc/cron.d (có cột user, quản lý được bằng deploy)',
            'cat > /etc/cron.d/{{name}} <<\'EOF\'\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n15 3 * * * root /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1\nEOF\nchmod 644 /etc/cron.d/{{name}}',
            'File trong cron.d phải kết thúc bằng xuống dòng và không có dấu chấm trong tên.'
          ),
          s('Kiểm cron có chạy không', 'grep CRON /var/log/syslog | tail -20\njournalctl -u cron -n 20 --no-pager', 'RHEL: `journalctl -u crond`. Không thấy dòng nào = cron chưa tới giờ hoặc service chưa chạy: `systemctl status cron`.')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'nginx-allow-deny',
    title: 'Nginx: chỉ cho một số IP vào (allow/deny)',
    category: 'web',
    tags: ['nginx', 'allow', 'deny', 'ip', 'admin', 'whitelist', 'real_ip'],
    summary: 'Giới hạn một đường dẫn (vd /admin) hoặc cả site cho một vài IP. Kiểm cấu hình bằng `nginx -t` rồi reload, không restart.',
    warnings: ['Sau load balancer/Cloudflare, `$remote_addr` là IP của LB → allow/deny sai hết. Phải cấu hình `set_real_ip_from` + `real_ip_header X-Forwarded-For` (module realip) trước.'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Tìm file server block của site', 'nginx -T 2>/dev/null | grep -n "server_name {{domain}}"\nls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/'),
          s(
            'Thêm allow/deny vào location (hoặc cả server)',
            'location /admin/ {\n    allow {{ip}};\n    allow 10.20.30.0/24;\n    deny all;\n    # ... proxy_pass / fastcgi_pass như cũ\n}',
            'Thứ tự quan trọng: nginx duyệt từ trên xuống, khớp cái đầu tiên. `deny all` để cuối.'
          ),
          s('Sau LB/CDN: lấy IP thật của khách', 'set_real_ip_from 10.20.30.1;   # IP của LB\nreal_ip_header X-Forwarded-For;\nreal_ip_recursive on;', 'Đặt trong `http {}` hoặc `server {}`. Chỉ tin header từ đúng IP của LB, không phải từ mọi nơi.'),
          s('Kiểm cấu hình rồi reload (không cắt kết nối)', 'nginx -t && systemctl reload nginx'),
          s('Thử từ IP ngoài whitelist → phải 403', 'curl -I https://{{domain}}/admin/')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'apache-allow-deny',
    title: 'Apache: chỉ cho một số IP vào (Require ip)',
    category: 'web',
    tags: ['apache', 'httpd', 'require', 'allow', 'deny', 'htaccess', 'remoteip'],
    summary: 'Apache 2.4 dùng `Require`; cú pháp `Order/Allow/Deny` là của 2.2, trộn hai kiểu là lỗi khó hiểu.',
    warnings: ['Sau load balancer cần `mod_remoteip` (`RemoteIPHeader X-Forwarded-For` + `RemoteIPInternalProxy <ip LB>`) thì `Require ip` mới đúng.'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s(
            'Trong vhost hoặc .htaccess',
            '<Location "/admin">\n    Require ip {{ip}} 10.20.30.0/24\n</Location>\n\n# Nhiều điều kiện (IP hoặc user đăng nhập):\n<RequireAny>\n    Require ip {{ip}}\n    Require valid-user\n</RequireAny>',
            '.htaccess chỉ có tác dụng khi vhost có `AllowOverride AuthConfig` (hoặc All).'
          ),
          s('Sau LB: bật mod_remoteip', 'a2enmod remoteip   # Debian/Ubuntu\n# trong vhost:\nRemoteIPHeader X-Forwarded-For\nRemoteIPInternalProxy 10.20.30.1'),
          s('Kiểm cấu hình rồi reload', 'apachectl configtest && systemctl reload apache2', 'RHEL: `httpd -t && systemctl reload httpd`.'),
          s('Thử từ IP ngoài whitelist → phải 403', 'curl -I https://{{domain}}/admin/')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'nginx-vhost',
    title: 'Nginx: thêm site mới (server block)',
    category: 'web',
    tags: ['nginx', 'vhost', 'server block', 'site', 'php-fpm'],
    summary: 'Tạo server block cho một domain mới, bật lên, kiểm, reload, rồi cấp SSL.',
    warnings: [],
    variants: [
      {
        id: 'debian',
        label: 'Debian/Ubuntu (sites-available)',
        steps: [
          s('Tạo thư mục web và file cấu hình', 'mkdir -p /var/www/{{domain}}/public\nchown -R www-data:www-data /var/www/{{domain}}'),
          s(
            'Server block tối thiểu (PHP-FPM)',
            'cat > /etc/nginx/sites-available/{{domain}} <<\'EOF\'\nserver {\n    listen 80;\n    server_name {{domain}} www.{{domain}};\n    root /var/www/{{domain}}/public;\n    index index.php index.html;\n    access_log /var/log/nginx/{{domain}}.access.log;\n    error_log  /var/log/nginx/{{domain}}.error.log;\n\n    location / { try_files $uri $uri/ /index.php?$query_string; }\n    location ~ \\.php$ {\n        include snippets/fastcgi-php.conf;\n        fastcgi_pass unix:/run/php/php8.3-fpm.sock;\n    }\n    location ~ /\\.(?!well-known) { deny all; }\n}\nEOF',
            'Đổi `php8.3-fpm.sock` theo bản PHP đang chạy: `ls /run/php/`.'
          ),
          s('Bật site', 'ln -s /etc/nginx/sites-available/{{domain}} /etc/nginx/sites-enabled/'),
          s('Kiểm + reload', 'nginx -t && systemctl reload nginx'),
          s('Cấp SSL', 'certbot --nginx -d {{domain}} -d www.{{domain}}', 'Xem sổ tay "Cấp SSL Let\'s Encrypt".')
        ]
      },
      {
        id: 'rhel',
        label: 'RHEL/Alma/Rocky (conf.d)',
        steps: [
          s('File cấu hình nằm ở conf.d', 'vi /etc/nginx/conf.d/{{domain}}.conf', 'Nội dung server block như bản Debian; socket PHP-FPM thường là `/run/php-fpm/www.sock`.'),
          s('SELinux: cho phép nginx đọc web root và nối PHP-FPM', 'chcon -R -t httpd_sys_content_t /var/www/{{domain}}\nsetsebool -P httpd_can_network_connect 1', 'Quên SELinux là 403/502 mà log không nói rõ — kiểm `ausearch -m avc -ts recent`.'),
          s('Kiểm + reload', 'nginx -t && systemctl reload nginx')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'apache-vhost',
    title: 'Apache: thêm site mới (VirtualHost)',
    category: 'web',
    tags: ['apache', 'httpd', 'vhost', 'virtualhost', 'a2ensite'],
    summary: 'Tạo VirtualHost cho domain mới, bật, kiểm, reload.',
    warnings: [],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s(
            'File vhost',
            'cat > /etc/apache2/sites-available/{{domain}}.conf <<\'EOF\'\n<VirtualHost *:80>\n    ServerName {{domain}}\n    ServerAlias www.{{domain}}\n    DocumentRoot /var/www/{{domain}}/public\n    <Directory /var/www/{{domain}}/public>\n        AllowOverride All\n        Require all granted\n    </Directory>\n    ErrorLog ${APACHE_LOG_DIR}/{{domain}}.error.log\n    CustomLog ${APACHE_LOG_DIR}/{{domain}}.access.log combined\n</VirtualHost>\nEOF',
            'RHEL: đặt ở /etc/httpd/conf.d/{{domain}}.conf, log dir /var/log/httpd.'
          ),
          s('Bật site + rewrite', 'a2ensite {{domain}}.conf\na2enmod rewrite'),
          s('Kiểm + reload', 'apachectl configtest && systemctl reload apache2'),
          s('Cấp SSL', 'certbot --apache -d {{domain}} -d www.{{domain}}')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'ssl-letsencrypt',
    title: "Cấp / gia hạn SSL Let's Encrypt (certbot)",
    category: 'ssl',
    tags: ['certbot', 'letsencrypt', 'ssl', 'tls', 'https', 'renew', 'expiry'],
    summary: 'Cấp cert lần đầu, kiểm gia hạn tự động, và xem cert còn bao ngày. App có công cụ 🌐 Theo dõi URL báo khi cert còn dưới 14 ngày.',
    warnings: ['Cổng 80 phải mở tới server (HTTP-01 challenge). Sau load balancer thì cert nên cấp ở LB, hoặc dùng DNS-01.'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Cài certbot', 'apt-get install -y certbot python3-certbot-nginx   # Debian/Ubuntu\ndnf install -y certbot python3-certbot-nginx       # RHEL', 'Apache: thay `-nginx` bằng `-apache`.'),
          s('Cấp và tự sửa cấu hình web server', 'certbot --nginx -d {{domain}} -d www.{{domain}}', 'Chỉ lấy cert, không sửa config: `certbot certonly --webroot -w /var/www/{{domain}}/public -d {{domain}}`.'),
          s('Kiểm gia hạn tự động có chạy', 'systemctl list-timers | grep certbot\ncertbot renew --dry-run'),
          s('Xem cert đang phục vụ còn bao ngày', 'echo | openssl s_client -connect {{domain}}:443 -servername {{domain}} 2>/dev/null | openssl x509 -noout -dates'),
          s('Danh sách cert trên máy', 'certbot certificates')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'ssh-hardening',
    title: 'SSH: tắt đăng nhập mật khẩu, đổi cổng, giới hạn user',
    category: 'ssh',
    tags: ['sshd', 'sshd_config', 'password', 'port', 'root', 'hardening'],
    summary: 'Siết sshd mà không tự khoá mình: sửa xong kiểm cú pháp, mở kết nối MỚI thử, rồi mới đóng phiên cũ.',
    warnings: [
      SSH_LOCKOUT,
      'Đổi cổng: mở cổng mới trên firewall (và SELinux: `semanage port -a -t ssh_port_t -p tcp {{port}}`) TRƯỚC khi reload sshd.',
      'Ubuntu 22.04+: /etc/ssh/sshd_config.d/*.conf được Include và ĐÈ giá trị trong sshd_config (cloud-init hay đặt PasswordAuthentication yes ở đó). Kiểm bằng `sshd -T`.'
    ],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Chắc chắn đã đăng nhập được bằng key', 'ssh -o PasswordAuthentication=no {{user}}@{{domain}} true && echo KEY-OK', 'Chạy từ máy mình. Không ra KEY-OK thì đừng tắt mật khẩu. App có nút 🔑 đẩy public key lên host.'),
          s(
            'Sửa cấu hình',
            'vi /etc/ssh/sshd_config\n# PasswordAuthentication no\n# PermitRootLogin prohibit-password\n# Port {{port}}\n# AllowUsers {{user}} deploy',
            'Xem giá trị THỰC sau khi gộp mọi file Include: `sshd -T | grep -Ei "passwordauth|permitroot|^port|allowusers"`.'
          ),
          s('Kiểm cú pháp', 'sshd -t', 'Không in gì = ổn.'),
          s('Mở cổng mới trên firewall (nếu đổi cổng)', 'ufw allow {{port}}/tcp\n# hoặc: firewall-cmd --permanent --add-port={{port}}/tcp && firewall-cmd --reload'),
          s('Reload sshd — phiên đang mở KHÔNG bị cắt', 'systemctl reload sshd', 'Debian/Ubuntu tên service là `ssh`. Reload chứ không restart.', true),
          s('Từ máy mình mở phiên MỚI thử; thành công rồi mới đóng phiên cũ', 'ssh -p {{port}} {{user}}@{{domain}}')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'users-add-sudo',
    title: 'Thêm user sudo có SSH key',
    category: 'users',
    tags: ['adduser', 'useradd', 'sudo', 'wheel', 'authorized_keys'],
    summary: 'Tạo user mới, cho quyền sudo, gắn public key, thử đăng nhập.',
    warnings: [],
    variants: [
      {
        id: 'debian',
        label: 'Debian/Ubuntu',
        steps: [
          s('Tạo user + thêm vào nhóm sudo', 'adduser {{user}}\nusermod -aG sudo {{user}}'),
          s('Gắn public key', 'mkdir -p /home/{{user}}/.ssh && chmod 700 /home/{{user}}/.ssh\nvi /home/{{user}}/.ssh/authorized_keys   # dán public key\nchmod 600 /home/{{user}}/.ssh/authorized_keys\nchown -R {{user}}:{{user}} /home/{{user}}/.ssh', 'Quyền sai (.ssh 700, authorized_keys 600) là sshd IM LẶNG bỏ qua key.'),
          s('Thử từ máy mình', 'ssh {{user}}@{{domain}} sudo -n true && echo SUDO-OK')
        ]
      },
      {
        id: 'rhel',
        label: 'RHEL/Alma/Rocky',
        steps: [
          s('Tạo user + nhóm wheel', 'useradd -m {{user}}\npasswd {{user}}\nusermod -aG wheel {{user}}'),
          s('Gắn public key', 'mkdir -p /home/{{user}}/.ssh && chmod 700 /home/{{user}}/.ssh\nvi /home/{{user}}/.ssh/authorized_keys\nchmod 600 /home/{{user}}/.ssh/authorized_keys\nchown -R {{user}}:{{user}} /home/{{user}}/.ssh\nrestorecon -Rv /home/{{user}}/.ssh', 'SELinux: thiếu `restorecon` là key không được đọc.'),
          s('Thử', 'ssh {{user}}@{{domain}} sudo -n true && echo SUDO-OK')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'disk-full',
    title: 'Đĩa đầy: tìm và dọn',
    category: 'disk',
    tags: ['df', 'du', 'journalctl', 'apt clean', 'log', 'lsof'],
    summary: 'Tìm cái gì đang chiếm đĩa rồi dọn thứ an toàn trước (journal, cache gói, log cũ). App có công cụ 💾 Đĩa đầy ở đâu làm bước tìm.',
    warnings: ['Xoá file log đang được ghi (đã mở) KHÔNG trả lại chỗ trống cho tới khi tiến trình đóng file — dùng `truncate -s 0` hoặc restart service. Kiểm bằng `lsof +L1`.'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Phân vùng nào đầy', 'df -h\ndf -i   # inode cũng có thể hết'),
          s('Thư mục nào to (đi từ gốc xuống)', 'du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -15\ndu -xh --max-depth=1 /var 2>/dev/null | sort -h | tail -15'),
          s('File lớn', 'find / -xdev -type f -size +500M -printf "%s %p\\n" 2>/dev/null | sort -n | tail -20'),
          s('Dọn an toàn', 'journalctl --vacuum-size=200M\napt-get clean            # Debian/Ubuntu\ndnf clean all            # RHEL\nfind /var/log -name "*.gz" -mtime +30 -delete'),
          s('File đã xoá nhưng còn bị giữ', 'lsof +L1 | head', 'Cột SIZE lớn → restart tiến trình đó (hoặc `truncate -s 0 /proc/<pid>/fd/<fd>`).', true)
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'services-systemd',
    title: 'Xem, khởi động lại, đọc log một service (systemd)',
    category: 'services',
    tags: ['systemctl', 'journalctl', 'service', 'restart', 'enable'],
    summary: 'Bộ lệnh systemd hay dùng. App có công cụ ⚙ Services làm việc này có xác nhận.',
    warnings: [],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Trạng thái + 20 dòng log cuối', 'systemctl status {{unit}} --no-pager -l'),
          s('Log đầy đủ / theo dõi sống', 'journalctl -u {{unit}} -n 200 --no-pager\njournalctl -u {{unit}} -f'),
          s('Reload trước, restart sau', 'systemctl reload {{unit}} || systemctl restart {{unit}}', 'Reload giữ kết nối đang có (nginx, sshd, php-fpm); restart cắt hết.', true),
          s('Bật chạy cùng máy', 'systemctl enable --now {{unit}}'),
          s('Service nào đang failed', 'systemctl --failed')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'mysql-db-user',
    title: 'MySQL/MariaDB: tạo database + user, dump và restore',
    category: 'database',
    tags: ['mysql', 'mariadb', 'create database', 'grant', 'mysqldump', 'restore'],
    summary: 'Tạo DB utf8mb4, user chỉ có quyền trên DB đó, và dump/restore an toàn.',
    warnings: ['Không gõ mật khẩu trên command line (`-pMatKhau`): `ps` cho mọi user đọc được. Dùng `mysql_config_editor set` hoặc file ~/.my.cnf chmod 600.'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Vào mysql', 'mysql -u root -p'),
          s(
            'Tạo DB + user (SQL)',
            "CREATE DATABASE {{db}} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER '{{user}}'@'localhost' IDENTIFIED BY 'DoiMatKhauNay!';\nGRANT ALL PRIVILEGES ON {{db}}.* TO '{{user}}'@'localhost';\nFLUSH PRIVILEGES;",
            "App nối từ máy khác: thay 'localhost' bằng IP app (`'{{user}}'@'{{ip}}'`) và mở `bind-address` trong my.cnf."
          ),
          s('Dump (không khoá bảng InnoDB)', 'mysqldump --single-transaction --quick --routines --triggers {{db}} | gzip > /root/{{db}}-$(date +%F).sql.gz'),
          s('Restore', 'gunzip < /root/{{db}}-YYYY-MM-DD.sql.gz | mysql {{db}}', 'Restore ĐÈ dữ liệu đang có trong DB đích.', true),
          s('Query đang chạy lâu', "mysql -e \"SELECT id, user, time, state, LEFT(info, 100) FROM information_schema.processlist WHERE command <> 'Sleep' ORDER BY time DESC LIMIT 20;\"")
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'nginx-log-analysis',
    title: 'Đọc access log nginx: IP nào cào, lỗi 5xx ở đâu',
    category: 'logs',
    tags: ['nginx', 'access.log', 'awk', '5xx', 'top ip', 'bot'],
    summary: 'Vài dòng awk trả lời nhanh: ai đang gọi nhiều nhất, URL nào lỗi, lỗi bắt đầu từ lúc nào. App có 🪵 Xem log để theo dõi sống, kể cả nhiều host cùng lúc.',
    warnings: ['Sau load balancer, cột $1 là IP của LB — đọc IP thật ở `$http_x_forwarded_for` (cần log_format có trường này).'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Top IP', "awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -20"),
          s('Đếm 5xx và URL lỗi nhiều nhất', "awk '$9 ~ /^5/' /var/log/nginx/access.log | wc -l\nawk '$9 ~ /^5/ {print $7}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head"),
          s('Lỗi theo từng phút (thấy đỉnh)', "awk '$9 ~ /^5/ {print substr($4, 2, 17)}' /var/log/nginx/access.log | uniq -c | tail -30"),
          s('User-agent lạ', "awk -F'\"' '{print $6}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head"),
          s('Lỗi upstream trong error.log', 'grep -E "upstream|timed out|connect\\(\\) failed" /var/log/nginx/error.log | tail -20')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'swap-add',
    title: 'Thêm swap file',
    category: 'disk',
    tags: ['swap', 'swapfile', 'fstab', 'swappiness', 'oom'],
    summary: 'Máy ít RAM bị OOM kill → thêm swap file để có đệm.',
    warnings: [],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Tạo file + bật', 'fallocate -l {{size}}G /swapfile\nchmod 600 /swapfile\nmkswap /swapfile\nswapon /swapfile', 'Ví dụ `{{size}}` = 2. Trên filesystem không hỗ trợ fallocate (xfs cũ): `dd if=/dev/zero of=/swapfile bs=1M count=2048`.'),
          s('Sống qua reboot', "grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab"),
          s('Ưu tiên RAM hơn swap', 'sysctl vm.swappiness=10\necho "vm.swappiness=10" > /etc/sysctl.d/99-swappiness.conf'),
          s('Kiểm', 'swapon --show; free -h')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'ports-listening',
    title: 'Cổng nào đang mở, tiến trình nào giữ cổng',
    category: 'network',
    tags: ['ss', 'netstat', 'lsof', 'port', 'listen', 'nc'],
    summary: 'Trả lời "cổng 3306 mở cho ai" và "ai đang chiếm cổng 8080" trong hai lệnh. Kiểm kê fleet trong app cũng thu danh sách cổng mở của mọi máy.',
    warnings: [],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Mọi cổng TCP đang lắng nghe + tiến trình', 'ss -tlnp', 'Cột Local Address `0.0.0.0:` = mở ra ngoài, `127.0.0.1:` = chỉ nội bộ.'),
          s('Ai đang chiếm một cổng', 'ss -tlnp | grep ":{{port}} "\nlsof -i :{{port}}'),
          s('Kết nối đang mở tới một cổng', 'ss -tn state established "( sport = :{{port}} )" | wc -l'),
          s('Thử tới một cổng từ máy này', 'nc -zv {{ip}} {{port}}\ntimeout 3 bash -c "</dev/tcp/{{ip}}/{{port}}" && echo OPEN')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'time-ntp',
    title: 'Múi giờ và đồng bộ giờ (NTP)',
    category: 'services',
    tags: ['timedatectl', 'timezone', 'ntp', 'chrony', 'clock'],
    summary: 'Giờ lệch làm cert, cron, log và token 2FA sai hết.',
    warnings: [],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Xem', 'timedatectl'),
          s('Đặt múi giờ', 'timedatectl list-timezones | grep -i {{tz}}\ntimedatectl set-timezone {{tz}}', 'Ví dụ `{{tz}}` = Asia/Ho_Chi_Minh, Asia/Tokyo.'),
          s('Bật NTP', 'timedatectl set-ntp true\nchronyc sources -v   # hoặc: timedatectl timesync-status')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'docker-basics',
    title: 'Docker: log, vào container, dọn dung lượng',
    category: 'docker',
    tags: ['docker', 'compose', 'logs', 'exec', 'prune'],
    summary: 'Bộ lệnh hay dùng khi debug một container và khi đĩa đầy vì image cũ.',
    warnings: ['`docker system prune -a --volumes` xoá cả volume không gắn container — dữ liệu DB nằm trong volume có thể mất.'],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Container nào chạy / chết', 'docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"'),
          s('Log', 'docker logs -f --tail 200 {{name}}'),
          s('Vào shell', 'docker exec -it {{name}} sh', 'Image có bash thì dùng `bash`.'),
          s('Dung lượng docker chiếm', 'docker system df'),
          s('Dọn image/container dừng (giữ volume)', 'docker system prune -af', 'Thêm `--volumes` chỉ khi CHẮC không volume nào còn dữ liệu cần giữ.', true),
          s('Compose', 'docker compose ps\ndocker compose up -d --pull always\ndocker compose logs -f --tail 100')
        ]
      }
    ],
    builtin: true
  },
  {
    id: 'security-quick-check',
    title: 'Kiểm nhanh an ninh một máy',
    category: 'ssh',
    tags: ['last', 'lastb', 'fail2ban', 'auth.log', 'audit', 'security'],
    summary: 'Năm phút nhìn xem có ai đang cố vào, ai đã vào, cổng nào mở thừa.',
    warnings: [],
    variants: [
      {
        id: 'default',
        label: '',
        steps: [
          s('Ai đang đăng nhập, ai vừa đăng nhập', 'who\nlast -n 20'),
          s('Đăng nhập thất bại', 'lastb | head -30\ngrep -c "Failed password" /var/log/auth.log   # RHEL: /var/log/secure'),
          s('fail2ban đang chặn gì', 'fail2ban-client status sshd'),
          s('Cổng mở ra ngoài', 'ss -tlnp | grep "0.0.0.0:"'),
          s('User có quyền sudo', 'getent group sudo wheel'),
          s('Gói bảo mật chờ vá', 'apt list --upgradable 2>/dev/null | grep -i security\n# RHEL: dnf updateinfo list security', 'App có công cụ 📦 Máy nào cần vá quét cả fleet.')
        ]
      }
    ],
    builtin: true
  }
]
