<template>
  <div class="home">
    <!-- 欢迎区域 -->
    <!-- <el-row :gutter="20" class="welcome-section">
      <el-col :span="24">
        <div class="welcome-card">
          <div class="welcome-content">
            <h1>欢迎使用智能穿戴管理系统</h1>
            <p>智能穿戴设备数据管理平台，为您提供全面的设备管理、用户管理和数据分析服务</p>
          </div>
          <div class="welcome-time">
            <span class="time">{{ currentTime }}</span>
            <span class="date">{{ currentDate }}</span>
          </div>
        </div>
      </el-col>
    </el-row> -->

    <!-- 统计卡片 -->
    <el-row :gutter="20" class="stats-section">
      <el-col :xs="24" :sm="12" :md="12">
        <div class="stat-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
          <div class="stat-icon">
            <i class="el-icon-user"></i>
          </div>
          <div class="stat-info">
            <div class="stat-title">用户总数</div>
            <div class="stat-value">{{ stats.userCount }}</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="24" :sm="12" :md="12">
        <div class="stat-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
          <div class="stat-icon">
            <i class="el-icon-mobile-phone"></i>
          </div>
          <div class="stat-info">
            <div class="stat-title">设备总数</div>
            <div class="stat-value">{{ stats.deviceCount }}</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 快捷入口 -->
    <el-row :gutter="20" class="quick-section">
      <el-col :span="24">
        <el-card class="quick-card">
          <div slot="header" class="card-header">
            <span>快捷入口</span>
          </div>
          <el-row :gutter="20">
            <el-col :xs="12" :sm="8" :md="4" v-for="item in quickLinks" :key="item.path">
              <div class="quick-item" @click="goTo(item.path)">
                <div class="quick-icon" :style="{ background: item.color }">
                  <i :class="item.icon"></i>
                </div>
                <div class="quick-title">{{ item.title }}</div>
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <!-- 系统信息 -->
    <!-- <el-row :gutter="20" class="info-section">
      <el-col :xs="24" :md="12">
        <el-card class="info-card">
          <div slot="header" class="card-header">
            <span>系统信息</span>
          </div>
          <div class="info-list">
            <div class="info-item">
              <span class="info-label">系统名称</span>
              <span class="info-value">智能穿戴管理系统</span>
            </div>
            <div class="info-item">
              <span class="info-label">系统版本</span>
              <span class="info-value">v{{ version }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">运行环境</span>
              <span class="info-value">Vue 2.x + Element UI</span>
            </div>
            <div class="info-item">
              <span class="info-label">服务状态</span>
              <span class="info-value"><el-tag type="success" size="small">运行中</el-tag></span>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card class="info-card">
          <div slot="header" class="card-header">
            <span>功能简介</span>
          </div>
          <div class="feature-list">
            <div class="feature-item">
              <i class="el-icon-user-solid"></i>
              <span>用户管理 - 管理系统用户，查看用户健康数据</span>
            </div>
            <div class="feature-item">
              <i class="el-icon-mobile"></i>
              <span>设备管理 - 管理智能穿戴设备，OTA固件升级</span>
            </div>
            <div class="feature-item">
              <i class="el-icon-data-analysis"></i>
              <span>数据统计 - 健康数据统计与分析</span>
            </div>
            <div class="feature-item">
              <i class="el-icon-setting"></i>
              <span>系统设置 - 系统参数配置与管理</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row> -->
  </div>
</template>

<script>
import { getIndexData } from '@/api/login'

export default {
  name: "Index",
  data() {
    return {
      version: "1.0.0",
      currentTime: "",
      currentDate: "",
      timer: null,
      stats: {
        userCount: 0,
        deviceCount: 0,
        onlineCount: 0,
        todayDataCount: 0
      },
      quickLinks: [
        { title: "用户管理", icon: "el-icon-user", path: "/user-all/user", color: "#667eea" },
        { title: "用户日志", icon: "el-icon-document", path: "/user-all/log", color: "#fa709a" },
        { title: "设备管理", icon: "el-icon-mobile-phone", path: "/device-all/device", color: "#f5576c" },
        { title: "型号管理", icon: "el-icon-cpu", path: "/device-all/model", color: "#4facfe" },
        { title: "OTA管理", icon: "el-icon-upload2", path: "/device-all/ota", color: "#43e97b" },
        { title: "审核管理", icon: "el-icon-edit", path: "/system/aiLab", color: "#ff9800" },
      ]
    }
  },
  created() {
    this.updateTime()
    this.timer = setInterval(this.updateTime, 1000)
    getIndexData().then(response => {
      const data = response.data
      this.stats.userCount = data.userCount
      this.stats.deviceCount = data.deviceCount
      this.stats.onlineCount = data.onlineCount
      this.stats.todayDataCount = data.todayDataCount
    }).catch(error => {
      console.error("获取首页数据失败:", error)
      this.getStats()
    })
  },
  beforeDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
    }
  },
  methods: {
    updateTime() {
      const now = new Date()
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const seconds = String(now.getSeconds()).padStart(2, '0')
      this.currentTime = `${hours}:${minutes}:${seconds}`

      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
      const weekDay = weekDays[now.getDay()]
      this.currentDate = `${year}年${month}月${day}日 ${weekDay}`
    },
    getStats() {
      // 模拟统计数据，实际项目中应该调用后端接口
      this.stats = {
        userCount: 128,
        deviceCount: 256,
        onlineCount: 89,
        todayDataCount: 1024
      }
    },
    goTo(path) {
      this.$router.push(path)
    },
    goTarget(href) {
      window.open(href, "_blank")
    }
  }
}
</script>

<style scoped lang="scss">
.home {
  padding: 20px;
  background: #f5f7fa;
  min-height: calc(100vh - 84px);

  .welcome-section {
    margin-bottom: 20px;

    .welcome-card {
      background: linear-gradient(135deg, #1890ff 0%, #722ed1 100%);
      border-radius: 8px;
      padding: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #fff;

      .welcome-content {
        h1 {
          margin: 0 0 10px 0;
          font-size: 28px;
          font-weight: 500;
        }
        p {
          margin: 0;
          font-size: 14px;
          opacity: 0.8;
        }
      }

      .welcome-time {
        text-align: right;
        .time {
          display: block;
          font-size: 36px;
          font-weight: 300;
        }
        .date {
          display: block;
          font-size: 14px;
          opacity: 0.8;
          margin-top: 5px;
        }
      }
    }
  }

  .stats-section {
    margin-bottom: 20px;

    .stat-card {
      border-radius: 8px;
      padding: 20px;
      display: flex;
      align-items: center;
      color: #fff;
      margin-bottom: 20px;

      .stat-icon {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 15px;

        i {
          font-size: 28px;
        }
      }

      .stat-info {
        .stat-title {
          font-size: 14px;
          opacity: 0.9;
        }
        .stat-value {
          font-size: 28px;
          font-weight: 600;
          margin-top: 5px;
        }
      }
    }
  }

  .quick-section {
    margin-bottom: 20px;

    .quick-card {
      .card-header {
        font-size: 16px;
        font-weight: 500;
      }

      .quick-item {
        text-align: center;
        padding: 20px 10px;
        cursor: pointer;
        border-radius: 8px;
        transition: all 0.3s;
        margin-bottom: 10px;

        &:hover {
          background: #f5f7fa;
          transform: translateY(-3px);
        }

        .quick-icon {
          width: 50px;
          height: 50px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 10px;

          i {
            font-size: 24px;
            color: #fff;
          }
        }

        .quick-title {
          font-size: 14px;
          color: #333;
        }
      }
    }
  }

  .info-section {
    .info-card {
      margin-bottom: 20px;

      .card-header {
        font-size: 16px;
        font-weight: 500;
      }

      .info-list {
        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #f0f0f0;

          &:last-child {
            border-bottom: none;
          }

          .info-label {
            color: #666;
          }

          .info-value {
            color: #333;
            font-weight: 500;
          }
        }
      }

      .feature-list {
        .feature-item {
          padding: 12px 0;
          border-bottom: 1px solid #f0f0f0;
          display: flex;
          align-items: center;

          &:last-child {
            border-bottom: none;
          }

          i {
            font-size: 18px;
            color: #1890ff;
            margin-right: 10px;
          }

          span {
            color: #666;
            font-size: 14px;
          }
        }
      }
    }
  }
}
</style>

