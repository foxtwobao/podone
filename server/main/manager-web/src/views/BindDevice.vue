<template>
  <div class="bind">
    <h2>绑定设备</h2>
    <p v-if="!validCode" role="alert">链接里的激活码无效，请回到设备屏幕重新扫码或手动输入。</p>
    <template v-else>
      <p>激活码 <strong class="code">{{ code }}</strong></p>
      <p v-if="loading" role="status">正在读取智能体…</p>
      <template v-else-if="agents.length === 0">
        <p>还没有智能体，请先创建一个再绑定设备。</p>
        <el-button type="primary" @click="$router.replace('/home')">去创建智能体</el-button>
      </template>
      <template v-else>
        <p v-if="agents.length > 1">选择要绑定到的智能体：</p>
        <el-radio-group v-model="agentId" class="agents">
          <el-radio v-for="agent in agents" :key="agent.id" :label="agent.id">{{ agent.agentName }}</el-radio>
        </el-radio-group>
        <div class="actions">
          <el-button type="primary" :loading="binding" :disabled="!agentId" @click="bind">绑定</el-button>
          <el-button @click="$router.replace('/home')">取消</el-button>
        </div>
      </template>
    </template>
  </div>
</template>

<script>
import Api from '@/apis/api';

export default {
  name: 'BindDevice',
  data() {
    const code = String(this.$route.query.code || '');
    return { code, validCode: /^\d{6}$/.test(code), agents: [], agentId: '', loading: true, binding: false };
  },
  mounted() {
    if (!this.validCode) return;
    Api.agent.getAgentList(({ data }) => {
      this.agents = data?.data || [];
      if (this.agents.length === 1) this.agentId = this.agents[0].id;
      this.loading = false;
    });
  },
  methods: {
    bind() {
      this.binding = true;
      Api.device.bindDevice(this.agentId, this.code, ({ data }) => {
        this.binding = false;
        if (data.code === 0) {
          this.$message.success({ message: this.$t('device.bindSuccess'), showClose: true });
          this.$router.replace({ path: '/device-management', query: { agentId: this.agentId } });
        } else {
          this.$message.error({ message: data.msg || this.$t('device.bindFailed'), showClose: true });
        }
      });
    },
  },
};
</script>

<style scoped>
.bind { max-width: 420px; margin: 0 auto; padding: 64px 24px; text-align: left; }
.code { font-size: 24px; letter-spacing: 4px; }
.agents { display: flex; flex-direction: column; gap: 12px; margin: 12px 0 24px; }
.actions { display: flex; gap: 8px; }
</style>
